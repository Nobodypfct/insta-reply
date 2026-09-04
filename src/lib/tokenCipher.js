const crypto = require('crypto');
const env = require('../config/env');

// Шифрование `page_access_token` перед записью в БД и расшифровка на чтении.
// AES-256-GCM (аутентифицированное: конфиденциальность + защита от подмены).
// Формат хранения: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>".
// Префикс версии — чтобы можно было менять ключ/алгоритм без гадания.
//
// Единственная точка вызова — igAccount.repository.js. Слои services/routes
// про шифрование не знают, получают уже открытый токен.
//
// От чего защищает: утечка дампа/бэкапа БД, доступ к БД в обход env Render,
// случайное попадание в логи. НЕ защищает от компрометации самого процесса
// (у него и ключ, и БД) — это отдельный шаг эскалации (KMS/Vault), см. TODO.

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // рекомендуемая длина IV для GCM

// env.js уже проверил наличие TOKEN_ENC_KEY и что он декодится в 32 байта
const KEY = Buffer.from(env.tokenEncKey, 'base64');

function encrypt(plaintext) {
  if (plaintext == null) return plaintext;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

// бросает, если формат не тот (plaintext до миграции), ключ не подходит
// или данные подменены. Вызывающий код (репозиторий) ловит и отдаёт
// page_access_token = null, не роняя весь запрос.
function decrypt(stored) {
  if (stored == null) return stored;

  if (typeof stored !== 'string' || !stored.startsWith(`${VERSION}:`)) {
    throw new Error('token is not in expected encrypted format');
  }

  const [, ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('malformed encrypted token');
  }

  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt, VERSION };
