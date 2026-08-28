require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { state, pickRandomReply, recordActivity } = require('./store');
const { startBot } = require('./bot');

const app = express();
app.use(express.json());

const {
  VERIFY_TOKEN,
  PORT = 3000,
} = process.env;

// ---- verification эндпоинт ----
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---- основной эндпоинт событий ----
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  // если бот выключен через телеграм - ничего не делаем
  if (!state.enabled) {
    console.log('автоответчик выключен, пропускаем событие');
    return;
  }

  // если инстаграм еще не подключен (нет токенов) - тоже ничего не делаем
  if (!state.ig.pageAccessToken || !state.ig.igBusinessId) {
    console.log('Instagram не подключен (нет токена/id), пропускаем событие');
    return;
  }

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === 'comments') {
          await handleNewComment(change.value);
        }
      }
    }
  } catch (err) {
    console.error('webhook processing error:', err.message);
  }
});

async function handleNewComment(commentData) {
  const commentId = commentData.id;
  const fromUserId = commentData.from?.id;
  const text = commentData.text;

  if (!commentId || !fromUserId) return;

  console.log(`new comment ${commentId} from ${fromUserId}: "${text}"`);

  await replyToComment(commentId, pickRandomReply());
  await sendDirectMessage(fromUserId, state.dmText);
  recordActivity();
}

async function replyToComment(commentId, message) {
  try {
    await axios.post(
      `https://graph.instagram.com/v21.0/${commentId}/replies`,
      { message },
      { params: { access_token: state.ig.pageAccessToken } }
    );
    console.log(`replied to comment ${commentId}`);
  } catch (err) {
    console.error('reply error:', err.response?.data || err.message);
  }
}

async function sendDirectMessage(recipientId, message) {
  try {
    await axios.post(
      `https://graph.instagram.com/v21.0/${state.ig.igBusinessId}/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      { params: { access_token: state.ig.pageAccessToken } }
    );
    console.log(`sent DM to ${recipientId}`);
  } catch (err) {
    console.error('dm error:', err.response?.data || err.message);
  }
}

app.get('/', (req, res) => res.send('ig-autoresponder is running'));

app.listen(PORT, () => {
  console.log(`server listening on port ${PORT}`);
  startBot(); // запускаем телеграм-бота вместе с сервером
});
