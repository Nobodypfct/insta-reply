require('dotenv').config();

// централизованное чтение и валидация переменных окружения -
// один источник правды вместо process.env, разбросанного по всему проекту

const env = {
  port: process.env.PORT || 3000,
  frontendUrl: process.env.FRONTEND_URL,
  verifyToken: process.env.VERIFY_TOKEN,

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  instagram: {
    appId: process.env.IG_APP_ID?.trim(),
    appSecret: process.env.IG_APP_SECRET?.trim(),
  },
};

// падаем сразу при старте, если чего-то критичного не хватает,
// а не через час случайной ошибкой в проде
const required = [
  ['SUPABASE_URL', env.supabase.url],
  ['SUPABASE_SERVICE_ROLE_KEY', env.supabase.serviceRoleKey],
  ['VERIFY_TOKEN', env.verifyToken],
];

for (const [name, value] of required) {
  if (!value) {
    console.warn(`⚠️  переменная окружения ${name} не задана`);
  }
}

module.exports = env;
