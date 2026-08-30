const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// service_role key используется только на сервере, никогда не попадает в браузер
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// создать или обновить ig_account (используется при OAuth-подключении)
async function upsertIgAccount({
  userId,
  igBusinessId,
  username,
  pageAccessToken,
  tokenExpiresAt,
}) {
  const { data, error } = await supabase
    .from("ig_accounts")
    .upsert(
      {
        user_id: userId,
        ig_business_id: igBusinessId,
        username,
        page_access_token: pageAccessToken,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: "ig_business_id" },
    )
    .select()
    .single();

  if (error) {
    console.error("upsertIgAccount error:", error.message);
    return null;
  }

  // при первом подключении сразу создаём дефолтные шаблоны и dm_settings,
  // если их ещё нет для этого аккаунта
  const { data: existingTemplates } = await supabase
    .from("reply_templates")
    .select("id")
    .eq("ig_account_id", data.id)
    .limit(1);

  if (!existingTemplates || existingTemplates.length === 0) {
    await supabase.from("reply_templates").insert([
      {
        ig_account_id: data.id,
        text: "Спасибо! Ссылку отправил тебе в директ 🚀",
      },
      { ig_account_id: data.id, text: "Отправил детали в личку, проверь 📩" },
    ]);
  }

  await supabase.from("dm_settings").upsert(
    {
      ig_account_id: data.id,
      dm_text:
        "Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]",
    },
    { onConflict: "ig_account_id" },
  );

  return data;
}

// получить все подключённые аккаунты конкретного юзера (для дашборда)
async function getIgAccountsByUser(userId) {
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id, ig_business_id, username, webhook_enabled, created_at")
    .eq("user_id", userId);

  if (error) {
    console.error("getIgAccountsByUser error:", error.message);
    return [];
  }
  return data;
}

// --- ig_accounts ---

// найти подключённый аккаунт по его instagram business id
// (используется, когда приходит вебхук - нужно понять, чей это аккаунт)
async function getIgAccountByBusinessId(igBusinessId) {
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("*")
    .eq("ig_business_id", igBusinessId)
    .single();

  if (error) {
    console.error("getIgAccountByBusinessId error:", error.message);
    return null;
  }
  return data;
}

// добавить новый подключённый аккаунт (пока используем вручную, без OAuth-флоу)
async function createIgAccount({
  userId,
  igBusinessId,
  username,
  pageAccessToken,
}) {
  const { data, error } = await supabase
    .from("ig_accounts")
    .insert({
      user_id: userId,
      ig_business_id: igBusinessId,
      username,
      page_access_token: pageAccessToken,
    })
    .select()
    .single();

  if (error) {
    console.error("createIgAccount error:", error.message);
    return null;
  }
  return data;
}

// --- reply_templates ---

async function getReplyTemplates(igAccountId) {
  const { data, error } = await supabase
    .from("reply_templates")
    .select("text")
    .eq("ig_account_id", igAccountId);

  if (error || !data || data.length === 0) {
    // дефолтные фразы, если для аккаунта ничего не настроено
    return [
      "Спасибо! Ссылку отправил тебе в директ 🚀",
      "Отправил детали в личку, проверь 📩",
      "Готово, лови в директе!",
    ];
  }
  return data.map((row) => row.text);
}

function pickRandomReply(templates) {
  return templates[Math.floor(Math.random() * templates.length)];
}

// --- dm_settings ---

async function getDmText(igAccountId) {
  const { data, error } = await supabase
    .from("dm_settings")
    .select("dm_text")
    .eq("ig_account_id", igAccountId)
    .single();

  if (error || !data) {
    return "Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]";
  }
  return data.dm_text;
}

// --- activity_log ---

async function logActivity({
  igAccountId,
  commentId,
  commenterId,
  commenterUsername,
  commentText,
  postId,
  repliedAt,
  dmSentAt,
  dmSuccess,
}) {
  const { error } = await supabase.from("activity_log").insert({
    ig_account_id: igAccountId,
    comment_id: commentId,
    commenter_id: commenterId,
    commenter_username: commenterUsername || null,
    comment_text: commentText || null,
    post_id: postId || null,
    replied_at: repliedAt || null,
    dm_sent_at: dmSentAt || null,
    dm_success: dmSuccess || false,
  });

  if (error) {
    console.error("logActivity error:", error.message);
  }
}

module.exports = {
  getIgAccountByBusinessId,
  createIgAccount,
  upsertIgAccount,
  getIgAccountsByUser,
  getReplyTemplates,
  pickRandomReply,
  getDmText,
  logActivity,
};
