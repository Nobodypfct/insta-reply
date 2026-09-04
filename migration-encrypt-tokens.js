// Миграция: шифрует существующие page_access_token в ig_accounts.
// Идемпотентна - строки с префиксом "v1:" и пустые пропускает.
//
// Шифротекст (AES-256-GCM) может сделать только этот код, ключом
// TOKEN_ENC_KEY - чистого .sql-файла быть не может. Поэтому два режима:
//
//   node migration-encrypt-tokens.js            -> печатает готовый SQL в stdout
//                                                  (вставить в Supabase SQL Editor)
//   node migration-encrypt-tokens.js --apply    -> пишет напрямую через supabase-js
//
// Окружение (как для сервера, минимум SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// + TOKEN_ENC_KEY) должно быть выставлено в обоих режимах - ключ нужен для
// самого шифрования.
//
// ВАЖНО: прогнать СРАЗУ после деплоя кода с шифрованием. До прогона старые
// plaintext-токены не проходят decrypt -> igAccount.repository отдаёт
// page_access_token = null, и бот по этим аккаунтам не работает.
//
// Файл оставляем в репо как история (по аналогии с migration-*.sql).

const supabase = require('./src/lib/supabase');
const { encrypt, VERSION } = require('./src/lib/tokenCipher');

const APPLY = process.argv.includes('--apply');

function needsEncryption(value) {
  return value && !value.startsWith(`${VERSION}:`);
}

async function main() {
  const { data: rows, error } = await supabase
    .from('ig_accounts')
    .select('id, page_access_token');

  if (error) {
    console.error('чтение ig_accounts не удалось:', error.message);
    process.exit(1);
  }

  const todo = rows.filter((r) => needsEncryption(r.page_access_token));
  const skipped = rows.length - todo.length;

  if (APPLY) {
    for (const row of todo) {
      const { error: updErr } = await supabase
        .from('ig_accounts')
        .update({ page_access_token: encrypt(row.page_access_token) })
        .eq('id', row.id);
      if (updErr) {
        console.error(`строка ${row.id}: update не удался:`, updErr.message);
        process.exit(1);
      }
    }
    console.error(`применено: зашифровано ${todo.length}, пропущено ${skipped}`);
    return;
  }

  // режим генерации SQL - всё служебное в stderr, чистый SQL в stdout
  console.error(`строк к шифрованию: ${todo.length}, пропущено (уже v1: / пусто): ${skipped}`);

  if (todo.length === 0) {
    console.log('-- нечего мигрировать: все page_access_token уже зашифрованы или пусты');
    return;
  }

  console.log(`-- Шифрование page_access_token, сгенерировано ${new Date().toISOString()}`);
  console.log(`-- ${todo.length} строк. Вставить в Supabase SQL Editor и выполнить.`);
  console.log('-- Значения = AES-256-GCM шифротекст; в логах Supabase осядет только он, это безопасно.');
  console.log('BEGIN;');
  for (const row of todo) {
    const ct = encrypt(row.page_access_token);
    // формат v1:base64:base64:base64 - кавычек/бэкслешей быть не может,
    // но подстрахуемся
    if (ct.includes("'") || ct.includes('\\')) {
      console.error(`строка ${row.id}: неожиданный символ в шифротексте, прерываю`);
      process.exit(1);
    }
    console.log(`UPDATE public.ig_accounts SET page_access_token = '${ct}' WHERE id = '${row.id}';`);
  }
  console.log('COMMIT;');
}

main();
