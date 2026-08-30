const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// service_role key используется только на сервере, никогда не попадает в браузер
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  getReplyTemplates,
  pickRandomReply,
  getDmText,
  logActivity,
};
