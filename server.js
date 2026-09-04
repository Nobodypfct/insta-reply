const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('./src/config/env');
const { requireAuth } = require('./src/middleware/auth');
const webhookRoutes = require('./src/routes/webhook.routes');
const igAccountsRoutes = require('./src/routes/igAccounts.routes');
const templatesRoutes = require('./src/routes/templates.routes');

const app = express();

app.disable('x-powered-by'); // не палим стек
app.use(helmet()); // security-заголовки (HSTS, nosniff, frameguard и т.д.)

// только настроенный origin фронтенда; env.js падает на старте, если не задан
app.use(cors({ origin: env.frontendUrl }));

// verify сохраняет сырое тело для проверки подписи вебхука (HMAC считается
// по байтам ровно как прислала Meta, распарсенный JSON не подходит).
// limit - явная граница против абузов (дефолт express тоже 100kb)
app.use(
  express.json({
    limit: '100kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get('/', (req, res) => res.send('ig-autoresponder is running'));

// вебхук аутентифицируется своей подписью (внутри роутера), не Bearer-токеном
app.use(webhookRoutes);

// всё под /api/* требует валидный Supabase JWT; req.userId ставится здесь
app.use('/api', requireAuth);
app.use(igAccountsRoutes);
app.use(templatesRoutes);

// единый обработчик ошибок: наружу не отдаём стек/внутренности.
// ловит в т.ч. ошибки body-parser (кривой JSON, тело больше лимита)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('unhandled error:', err.message);
    return res.status(500).json({ code: 'internal_error', message: 'internal error' });
  }
  return res.status(status).json({ code: 'bad_request', message: err.message });
});

app.listen(env.port, () => console.log(`server listening on port ${env.port}`));
