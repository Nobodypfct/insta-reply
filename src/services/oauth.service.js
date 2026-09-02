const igAccountRepo = require('../repositories/igAccount.repository');
const templateRepo = require('../repositories/template.repository');
const instagramService = require('./instagram.service');

const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000; // 60 дней

// принимает уже долгоживущий токен (обмен делается на фронтенде через Auth.js),
// сохраняет аккаунт, подписывает на вебхуки.
// возвращает { conflict: true, existingOwnerEmail, username } если аккаунт
// уже подключён другим юзером и forceTransfer не передан
async function completeConnection({ userId, longLivedToken, forceTransfer }) {
  const { igBusinessId, username, profilePictureUrl } = await instagramService.getMe(longLivedToken);

  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  const savedAccount = await igAccountRepo.upsert({
    userId,
    igBusinessId,
    username,
    avatarUrl: profilePictureUrl,
    pageAccessToken: longLivedToken,
    tokenExpiresAt: expiresAt,
    forceTransfer,
  });

  if (!savedAccount) {
    throw new Error('failed to save account to database');
  }

  if (savedAccount.conflict) {
    return { conflict: true, existingOwnerEmail: savedAccount.existingOwnerEmail, username };
  }

  if (savedAccount._isTransfer) {
    await templateRepo.clearForAccount(savedAccount.id);
  }
  await templateRepo.ensureDefaults(savedAccount.id);

  await instagramService.subscribeToWebhooks(longLivedToken, igBusinessId);

  return { success: true, username };
}

module.exports = { completeConnection };
