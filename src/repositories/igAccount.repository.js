const supabase = require('../lib/supabase');

// маскирует email как do***@gmail.com, для показа при конфликте владельца
function maskEmail(email) {
  if (!email) return null;
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const visible = name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(name.length - 2, 3))}@${domain}`;
}

// найти аккаунт по его внутреннему id (не instagram business id) -
// используется, когда нужен токен/данные конкретной строки в ig_accounts
async function findById(id) {
  const { data, error } = await supabase.from('ig_accounts').select('*').eq('id', id).single();

  if (error) {
    console.error('igAccount.findById error:', error.message);
    return null;
  }
  return data;
}

// найти подключённый аккаунт по его instagram business id
// (используется, когда приходит вебхук - нужно понять, чей это аккаунт)
async function findByBusinessId(igBusinessId) {
  const { data, error } = await supabase
    .from('ig_accounts')
    .select('*')
    .eq('ig_business_id', igBusinessId)
    .single();

  if (error) {
    console.error('igAccount.findByBusinessId error:', error.message);
    return null;
  }
  return data;
}

// получить все подключённые аккаунты конкретного юзера (для дашборда)
async function findByUserId(userId) {
  const { data, error } = await supabase
    .from('ig_accounts')
    .select('id, ig_business_id, username, avatar_url, webhook_enabled, created_at')
    .eq('user_id', userId);

  if (error) {
    console.error('igAccount.findByUserId error:', error.message);
    return [];
  }
  return data;
}

// проверяет, кому уже принадлежит этот ig_business_id (если кому-то) -
// используется перед подключением, чтобы предупредить о переносе, как у ChatPlace
async function checkOwner(igBusinessId) {
  const { data, error } = await supabase
    .from('ig_accounts')
    .select('user_id, username, profiles(email)')
    .eq('ig_business_id', igBusinessId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    userId: data.user_id,
    username: data.username,
    maskedEmail: maskEmail(data.profiles?.email),
  };
}

// создать или обновить ig_account (используется при OAuth-подключении).
// возвращает { conflict: true, existingOwnerEmail } если аккаунт уже занят
// другим юзером и forceTransfer не передан явно
async function upsert({ userId, igBusinessId, username, avatarUrl, pageAccessToken, tokenExpiresAt, forceTransfer }) {
  const existingOwner = await checkOwner(igBusinessId);
  if (existingOwner && existingOwner.userId !== userId && !forceTransfer) {
    return { conflict: true, existingOwnerEmail: existingOwner.maskedEmail };
  }

  const row = {
    user_id: userId,
    ig_business_id: igBusinessId,
    username,
    page_access_token: pageAccessToken,
    token_expires_at: tokenExpiresAt,
  };
  // не затираем сохранённый аватар значением null, если Instagram вдруг
  // не отдал profile_picture_url при повторном подключении
  if (avatarUrl !== undefined && avatarUrl !== null) row.avatar_url = avatarUrl;

  const { data, error } = await supabase
    .from('ig_accounts')
    .upsert(row, { onConflict: 'ig_business_id' })
    .select()
    .single();

  if (error) {
    console.error('igAccount.upsert error:', error.message);
    return null;
  }

  const isTransfer = existingOwner && existingOwner.userId !== userId;
  return { ...data, _isTransfer: isTransfer };
}

module.exports = { findById, findByBusinessId, findByUserId, checkOwner, upsert };
