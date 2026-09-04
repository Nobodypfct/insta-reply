const { createRemoteJWKSet, jwtVerify } = require('jose');
const env = require('../config/env');

// проверка пользовательского Supabase access token (JWT).
// подпись асимметричная (ES256), ключ берётся из публичного JWKS проекта -
// jose сам качает и кэширует ключи, выбирает нужный по kid и переживает
// ротацию ключей без нашего участия. Сетевого похода на Supabase на каждый
// запрос нет.

function unauthorized(res, message) {
  return res.status(401).json({ code: 'unauthorized', message });
}

// keyResolver вынесен в параметр, чтобы в тестах подсунуть локальный
// набор ключей (createLocalJWKSet) вместо удалённого JWKS
function makeRequireAuth(keyResolver) {
  return async function requireAuth(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      return unauthorized(res, 'отсутствует Bearer-токен');
    }

    try {
      const { payload } = await jwtVerify(token, keyResolver, {
        issuer: env.supabase.jwtIssuer,
        audience: 'authenticated',
      });

      // role=authenticated отсекает anon- и service_role-токены
      if (payload.role !== 'authenticated' || !payload.sub) {
        return unauthorized(res, 'недопустимые claims токена');
      }

      req.userId = payload.sub;
      return next();
    } catch (err) {
      console.warn('auth: проверка токена не прошла:', err.code || err.message);
      return unauthorized(res, 'токен невалиден или истёк');
    }
  };
}

const requireAuth = makeRequireAuth(
  createRemoteJWKSet(new URL(env.supabase.jwksUrl))
);

module.exports = { requireAuth, makeRequireAuth };
