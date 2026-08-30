require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

const { VERIFY_TOKEN, PORT = 3000 } = process.env;

// ---- verification эндпоинт ----
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---- основной эндпоинт событий ----
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === "comments") {
          // media.id в payload это id аккаунта-владельца поста, на который подписан вебхук.
          // сама мета не всегда явно шлёт ig_business_id в comments payload напрямую -
          // поэтому ниже используем entry.id, где meta кладёт id аккаунта, подписанного на вебхук
          const igBusinessId = entry.id;
          await handleNewComment(igBusinessId, change.value);
        }
      }
    }
  } catch (err) {
    console.error("webhook processing error:", err.message);
  }
});

async function handleNewComment(igBusinessId, commentData) {
  const commentId = commentData.id;
  const fromUserId = commentData.from?.id;
  const fromUsername = commentData.from?.username;
  const text = commentData.text;
  const postId = commentData.media?.id;

  if (!commentId || !fromUserId) return;

  const igAccount = await db.getIgAccountByBusinessId(igBusinessId);
  if (!igAccount) {
    console.log(`ig account ${igBusinessId} not found in db, skipping`);
    return;
  }

  // защита от петли: игнорируем комментарии от самого себя (наши же ответы)
  if (fromUserId === igAccount.ig_business_id) {
    console.log(`skipping own comment ${commentId} (avoiding reply loop)`);
    return;
  }

  if (!igAccount.webhook_enabled) {
    console.log(`webhook disabled for ${igAccount.username}, skipping`);
    return;
  }

  console.log(
    `[${igAccount.username}] new comment ${commentId} from ${fromUserId}: "${text}"`,
  );

  const templates = await db.getReplyTemplates(igAccount.id);
  const replyText = db.pickRandomReply(templates);
  const dmText = await db.getDmText(igAccount.id);

  const replySuccess = await replyToComment(
    igAccount.page_access_token,
    commentId,
    replyText,
  );
  const dmSuccess = await sendDirectMessage(
    igAccount.page_access_token,
    igAccount.ig_business_id,
    commentId,
    dmText,
  );

  await db.logActivity({
    igAccountId: igAccount.id,
    commentId,
    commenterId: fromUserId,
    commenterUsername: fromUsername,
    commentText: text,
    postId,
    repliedAt: replySuccess ? new Date().toISOString() : null,
    dmSentAt: dmSuccess ? new Date().toISOString() : null,
    dmSuccess,
  });
}

async function replyToComment(accessToken, commentId, message) {
  try {
    await axios.post(
      `https://graph.instagram.com/v21.0/${commentId}/replies`,
      { message },
      { params: { access_token: accessToken } },
    );
    console.log(`replied to comment ${commentId}`);
    return true;
  } catch (err) {
    console.error("reply error:", err.response?.data || err.message);
    return false;
  }
}

async function sendDirectMessage(
  accessToken,
  igBusinessId,
  commentId,
  message,
) {
  try {
    await axios.post(
      `https://graph.instagram.com/v21.0/${igBusinessId}/messages`,
      {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      { params: { access_token: accessToken } },
    );
    console.log(`sent DM for comment ${commentId}`);
    return true;
  } catch (err) {
    console.error("dm error:", err.response?.data || err.message);
    return false;
  }
}

app.get("/", (req, res) => res.send("ig-autoresponder is running"));

// простой API для фронтенда - список подключённых аккаунтов юзера
app.get("/api/ig-accounts", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: "missing user_id" });

  const accounts = await db.getIgAccountsByUser(user_id);
  res.json({ accounts });
});

// ==================== OAuth: подключение Instagram клиентом ====================

const IG_APP_ID = process.env.IG_APP_ID?.trim();
const IG_APP_SECRET = process.env.IG_APP_SECRET?.trim();
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI?.trim();

// 1. кнопка "Подключить Instagram" на фронтенде ведёт сюда
// ?user_id=<uuid залогиненного юзера из Supabase Auth>
app.get("/auth/instagram/connect", (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send("missing user_id");

  const params = new URLSearchParams({
    client_id: IG_APP_ID,
    redirect_uri: IG_REDIRECT_URI,
    response_type: "code",
    scope:
      "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages",
    state: user_id, // передаём id юзера через state, чтобы знать, кому привязать аккаунт после
  });

  res.redirect(
    `https://www.instagram.com/oauth/authorize?${params.toString()}`,
  );
});

// 2. Instagram редиректит сюда после того как юзер разрешил доступ
app.get("/auth/instagram/callback", async (req, res) => {
  const { code: rawCode, state: userId, error } = req.query;

  if (error) {
    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?connect_error=${error}`,
    );
  }
  if (!rawCode || !userId) {
    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?connect_error=missing_params`,
    );
  }

  // Instagram добавляет "#_" в конец кода при редиректе - это не часть самого кода,
  // нужно обрезать перед обменом (официально задокументированный нюанс Meta)
  const code = rawCode.replace(/#_$/, "");

  try {
    // шаг 1: обмениваем code на короткоживущий токен
    const shortTokenRes = await axios.post(
      "https://api.instagram.com/oauth/access_token",
      new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: IG_REDIRECT_URI,
        code,
      }),
    );
    const shortLivedToken = shortTokenRes.data.access_token;

    // шаг 2: обмениваем короткоживущий на долгоживущий (60 дней)
    const longTokenRes = await axios.get(
      "https://graph.instagram.com/access_token",
      {
        params: {
          grant_type: "ig_exchange_token",
          client_secret: IG_APP_SECRET,
          access_token: shortLivedToken,
        },
      },
    );
    const longLivedToken = longTokenRes.data.access_token;
    const expiresInSeconds = longTokenRes.data.expires_in;

    // шаг 3: узнаём id и username подключённого аккаунта
    const meRes = await axios.get("https://graph.instagram.com/v21.0/me", {
      params: { fields: "id,username", access_token: longLivedToken },
    });
    const { id: igBusinessId, username } = meRes.data;

    // шаг 4: сохраняем в БД, привязываем к юзеру, который инициировал подключение
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000,
    ).toISOString();
    await db.upsertIgAccount({
      userId,
      igBusinessId,
      username,
      pageAccessToken: longLivedToken,
      tokenExpiresAt: expiresAt,
    });

    // шаг 5: подписываем аккаунт на вебхуки
    await axios.post(
      `https://graph.instagram.com/v21.0/${igBusinessId}/subscribed_apps`,
      null,
      {
        params: {
          subscribed_fields: "comments,messages",
          access_token: longLivedToken,
        },
      },
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?connected=${username}`);
  } catch (err) {
    console.error("instagram oauth error:", err.response?.data || err.message);
    res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?connect_error=oauth_failed`,
    );
  }
});

app.listen(PORT, () => console.log(`server listening on port ${PORT}`));
