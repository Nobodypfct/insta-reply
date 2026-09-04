const express = require('express');
const env = require('../config/env');
const webhookService = require('../services/webhook.service');
const { verifyWebhookSignature } = require('../middleware/webhookSignature');

const router = express.Router();

// verification эндпоинт - meta дёргает его один раз при настройке вебхука
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.verifyToken) {
    console.log('webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// основной эндпоинт событий - сюда meta шлёт новые комментарии.
// verifyWebhookSignature отсекает всё без валидной подписи Meta (403)
router.post('/webhook', verifyWebhookSignature, async (req, res) => {
  res.sendStatus(200); // отвечаем сразу, обработка асинхронная

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      // messaging-события (клик по кнопке в DM, входящее DM-сообщение)
      // приходят в другом формате, чем comments: entry.messaging[] вместо
      // entry.changes[]
      if (Array.isArray(entry.messaging)) {
        for (const event of entry.messaging) {
          // для messaging бизнес-аккаунт = получатель (recipient.id);
          // entry.id тоже обычно он, но recipient надёжнее
          const igBusinessId = event.recipient?.id || entry.id;
          const senderId = event.sender?.id;

          if (event.postback) {
            await webhookService.handlePostback(igBusinessId, senderId, event.postback.payload);
            continue;
          }

          // входящее DM-сообщение. is_echo - это эхо нашего же исходящего
          // сообщения (бот сам его отправил), НЕ реальное входящее - иначе
          // реплай-петля/дубли. Сообщение без text (стикер/вложение) - тоже
          // пропускаем, матчить не на что
          if (event.message && !event.message.is_echo && event.message.text) {
            await webhookService.handleIncomingDm(igBusinessId, senderId, event.message.text);
          }
        }
        continue;
      }

      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === 'comments') {
          // media.id в payload это id поста, entry.id - id аккаунта-владельца,
          // на который подписан вебхук
          const igBusinessId = entry.id;
          await webhookService.handleNewComment(igBusinessId, change.value);
        }
      }
    }
  } catch (err) {
    console.error('webhook processing error:', err.message);
  }
});

module.exports = router;
