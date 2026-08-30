// одноразовый скрипт, чтобы вручную добавить тестовый ig-аккаунт в базу
// пока нет личного кабинета / OAuth-флоу для самостоятельного подключения
//
// использование:
// SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node seed-test-account.js

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// !!! заполни своими реальными значениями перед запуском !!!
const TEST_USER_EMAIL = "dojnikov.nickolaj@gmail.com"; // просто для profiles, реальный auth пока не используем
const IG_BUSINESS_ID = "17841443148025614"; // etot_chuvak
const USERNAME = "etot_chuvak";
const PAGE_ACCESS_TOKEN =
  "IGAAO6q5D7r2VBZAGF3MHJiNnhjVkZAWeUlCZAU5mcTd0OGtsVXlvVWJfbTNXVVJSUjBFT0RnUEFuTFQ2U3NLWFRmY1ZAyUjI4Tnp0bno4bDdsdlhNblJWMUZA6M2tQN2tnZAUZAxUkdNYTlET3VJd1d1TnktUXkxM2ZAaUlRVdHhmUU9jawZDZD";

async function seed() {
  // 1. создаём "профиль" вручную (без реальной auth-регистрации, просто заглушка на этом этапе)
  const fakeUserId = "aec4792b-793e-4c53-a565-0a0eeb794d79";

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: fakeUserId, email: TEST_USER_EMAIL });

  if (profileError) {
    console.error("profile error:", profileError.message);
    return;
  }

  // 2. создаём ig_account
  const { data, error } = await supabase
    .from("ig_accounts")
    .upsert(
      {
        user_id: fakeUserId,
        ig_business_id: IG_BUSINESS_ID,
        username: USERNAME,
        page_access_token: PAGE_ACCESS_TOKEN,
      },
      { onConflict: "ig_business_id" },
    )
    .select()
    .single();

  if (error) {
    console.error("ig_account error:", error.message);
    return;
  }

  console.log("успешно добавлен ig_account:", data);

  // 3. добавим пару шаблонов ответа
  await supabase.from("reply_templates").insert([
    {
      ig_account_id: data.id,
      text: "Спасибо! Ссылку отправил тебе в директ 🚀",
    },
    { ig_account_id: data.id, text: "Отправил детали в личку, проверь 📩" },
  ]);

  // 4. добавим dm_settings
  await supabase.from("dm_settings").upsert({
    ig_account_id: data.id,
    dm_text:
      "Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]",
  });

  console.log("готово! аккаунт настроен, можно тестировать вебхук.");
}

seed();
