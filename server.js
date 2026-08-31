const express = require('express');
const cors = require('cors');
const env = require('./src/config/env');
const webhookRoutes = require('./src/routes/webhook.routes');
const igAccountsRoutes = require('./src/routes/igAccounts.routes');

const app = express();
app.use(cors({ origin: env.frontendUrl }));
app.use(express.json());

app.get('/', (req, res) => res.send('ig-autoresponder is running'));

app.use(webhookRoutes);
app.use(igAccountsRoutes);

app.listen(env.port, () => console.log(`server listening on port ${env.port}`));
