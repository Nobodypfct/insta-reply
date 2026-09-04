const express = require('express');
const cors = require('cors');
const env = require('./src/config/env');
const { requireAuth } = require('./src/middleware/auth');
const webhookRoutes = require('./src/routes/webhook.routes');
const igAccountsRoutes = require('./src/routes/igAccounts.routes');
const templatesRoutes = require('./src/routes/templates.routes');

const app = express();

// только настроенный origin фронтенда; env.js падает на старте, если не задан
app.use(cors({ origin: env.frontendUrl }));

// verify сохраняет сырое тело для проверки подписи вебхука (HMAC считается
// по байтам ровно как прислала Meta, распарсенный JSON не подходит)
app.use(
  express.json({
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

app.listen(env.port, () => console.log(`server listening on port ${env.port}`));
