require("dotenv").config();
const express = require("express");
const axios = require("axios");
const db = require("./db");

const app = express();
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

app.listen(PORT, () => console.log(`server listening on port ${PORT}`));
