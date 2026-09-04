const crypto = require('crypto');
const env = require('../config/env');

// Meta подписывает каждый POST вебхука заголовком
// X-Hub-Signature-256: sha256=<hmac>, ключ - app secret.
// без этой проверки кто угодно, зная URL, может слать боту фейковые
// события (комментарии/postback) и заставлять его отвечать/слать DM.
// требует сырое тело запроса - см. express.json({ verify }) в server.js.
function verifyWebhookSignature(req, res, next) {
  const provided = req.get('x-hub-signature-256');
  if (!provided || !Buffer.isBuffer(req.rawBody)) {
    console.warn('webhook signature missing');
    return res.sendStatus(403);
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', env.instagram.appSecret).update(req.rawBody).digest('hex');

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn('webhook signature mismatch');
    return res.sendStatus(403);
  }

  return next();
}

module.exports = { verifyWebhookSignature };
