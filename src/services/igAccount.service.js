const igAccountRepo = require('../repositories/igAccount.repository');
const instagramService = require('./instagram.service');

// Instagram отдаёт profile_picture_url только в момент OAuth-подключения,
// и это подписанный CDN-URL с ограниченным TTL. Чтобы аватарка не протухала,
// но и не дёргать Graph API на каждый GET /api/ig-accounts, обновляем её
// лениво: не чаще раза в 24 часа на аккаунт. Крон/воркер не нужен.
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;

function isAvatarStale(updatedAt) {
  if (!updatedAt) return true;
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > AVATAR_TTL_MS;
}

// публичный шейп IgAccount для HTTP-ответа - без page_access_token и
// прочих внутренних полей
function toPublic(account, avatarUrl) {
  return {
    id: account.id,
    ig_business_id: account.ig_business_id,
    username: account.username,
    avatar_url: avatarUrl ?? null,
    webhook_enabled: account.webhook_enabled,
    created_at: account.created_at,
  };
}

// вернуть актуальный avatar_url для аккаунта, при необходимости сходив
// за свежим в Graph API. Любой сбой рефреша проглатывается - отдаём то,
// что уже лежит в БД (фронт корректно откатится на заглушку).
async function resolveAvatarUrl(account) {
  if (!isAvatarStale(account.avatar_url_updated_at)) {
    return account.avatar_url;
  }

  const fresh = await instagramService.fetchProfilePictureUrl(account.page_access_token);
  if (fresh === null) {
    // токен отозван / Graph API упал - не трогаем БД, отдаём старое значение
    return account.avatar_url;
  }

  await igAccountRepo.updateAvatar(account.id, fresh);
  return fresh;
}

// список подключённых аккаунтов юзера для дашборда, с TTL-gated рефрешем
// аватарок. Рефреш каждого аккаунта независим - падение одного не влияет
// на остальных и не роняет ответ.
async function listForUser(userId) {
  const accounts = await igAccountRepo.findByUserId(userId);
  return Promise.all(
    accounts.map(async (account) => toPublic(account, await resolveAvatarUrl(account)))
  );
}

module.exports = { listForUser };
