require('dotenv').config();

// централизованное чтение и валидация переменных окружения -
// один источник правды вместо process.env, разбросанного по всему проекту

const supabaseUrl = process.env.SUPABASE_URL;

const env = {
  port: process.env.PORT || 3000,
  frontendUrl: process.env.FRONTEND_URL,
  verifyToken: process.env.VERIFY_TOKEN,

  // публичный URL ЭТОГО бэкенда (напр. https://ig-autoresponder.onrender.com) -
  // нужен, чтобы собрать редирект-ссылку вида {backendUrl}/r/<templateId>
  // для кнопок-ссылок в DM (см. lib/redirectLink.js). Опционально: без него
  // просто не шлём кнопку-ссылку (fallback на обычный текст), не hard-fail -
  // это фича, не безопасность. Без хвостового слэша, для чистой конкатенации.
  backendUrl: process.env.BACKEND_URL?.trim().replace(/\/+$/, '') || null,

  // ключ шифрования page_access_token в БД (AES-256-GCM), base64 от 32 байт.
  // сгенерировать: openssl rand -base64 32
  tokenEncKey: process.env.TOKEN_ENC_KEY,

  supabase: {
    url: supabaseUrl,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    // проверка пользовательских JWT: ключи асимметричные (ES256), берём их
    // из публичного JWKS проекта. Отдельный секрет не нужен.
    jwksUrl: supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : null,
    jwtIssuer: supabaseUrl ? `${supabaseUrl}/auth/v1` : null,
  },

  instagram: {
    appId: process.env.IG_APP_ID?.trim(),
    // используется и для обмена токенов, и для проверки подписи вебхука
    // (X-Hub-Signature-256) - без него нельзя доверять входящим событиям
    appSecret: process.env.IG_APP_SECRET?.trim(),
  },
};

// критичные переменные: без них приложение работает небезопасно или не
// работает вовсе - падаем сразу на старте, а не через час случайной
// ошибкой в проде (и чтобы нельзя было выкатить бэкенд без проверки токенов)
const critical = [
  ['SUPABASE_URL', env.supabase.url],
  ['SUPABASE_SERVICE_ROLE_KEY', env.supabase.serviceRoleKey],
  ['VERIFY_TOKEN', env.verifyToken],
  ['IG_APP_SECRET', env.instagram.appSecret],
  ['FRONTEND_URL', env.frontendUrl],
  ['TOKEN_ENC_KEY', env.tokenEncKey],
];

const missing = critical.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  throw new Error(
    `не заданы обязательные переменные окружения: ${missing.join(', ')}`
  );
}

// TOKEN_ENC_KEY должен декодиться ровно в 32 байта (ключ AES-256)
if (Buffer.from(env.tokenEncKey, 'base64').length !== 32) {
  throw new Error(
    'TOKEN_ENC_KEY должен быть base64 от 32 байт (openssl rand -base64 32)'
  );
}

module.exports = env;
