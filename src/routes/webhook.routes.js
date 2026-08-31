const express = require('express');
const env = require('../config/env');
const webhookService = require('../services/webhook.service');

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

// основной эндпоинт событий - сюда meta шлёт новые комментарии
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // отвечаем сразу, обработка асинхронная

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
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
