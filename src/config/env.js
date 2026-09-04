require('dotenv').config();

// централизованное чтение и валидация переменных окружения -
// один источник правды вместо process.env, разбросанного по всему проекту

const supabaseUrl = process.env.SUPABASE_URL;

const env = {
  port: process.env.PORT || 3000,
  frontendUrl: process.env.FRONTEND_URL,
  verifyToken: process.env.VERIFY_TOKEN,

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
];

const missing = critical.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  throw new Error(
    `не заданы обязательные переменные окружения: ${missing.join(', ')}`
  );
}

module.exports = env;
