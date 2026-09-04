const express = require('express');
const igAccountService = require('../services/igAccount.service');
const oauthService = require('../services/oauth.service');
const instagramService = require('../services/instagram.service');
const { requireIgAccountOwnership } = require('../middleware/ownership');

const router = express.Router();

// список подключённых аккаунтов юзера - для дашборда. юзер берётся из
// токена (requireAuth в server.js ставит req.userId), не из запроса.
// avatar_url при необходимости лениво обновляется из Graph API (см.
// igAccount.service.js) - не чаще раза в 24ч на аккаунт
router.get('/api/ig-accounts', async (req, res) => {
  const accounts = await igAccountService.listForUser(req.userId);
  res.json({ accounts });
});

// последние посты конкретного аккаунта - для выбора поста при создании шаблона
router.get('/api/ig-accounts/:igAccountId/media', requireIgAccountOwnership, async (req, res) => {
  const account = req.igAccount; // проверен и подгружен в requireIgAccountOwnership

  try {
    const media = await instagramService.getRecentMedia(account.page_access_token, account.ig_business_id);
    res.json({ media });
  } catch (err) {
    console.error('get media error:', err.message);
    res.status(500).json({ error: 'failed to fetch media' });
  }
});

// принимает long-lived токен Instagram, полученный на фронтенде,
// сохраняет аккаунт и подписывает на вебхуки.
// user_id больше не принимаем из тела - только из токена
router.post('/api/complete-instagram-connect', async (req, res) => {
  const {
    long_lived_token: longLivedToken,
    profile_picture_url: profilePictureUrl,
    force_transfer: forceTransfer,
  } = req.body;

  if (!longLivedToken) {
    return res.status(400).json({ error: 'missing required fields' });
  }

  try {
    const result = await oauthService.completeConnection({
      userId: req.userId,
      longLivedToken,
      profilePictureUrl,
      forceTransfer: forceTransfer === true,
    });

    if (result.conflict) {
      return res.status(409).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('complete-instagram-connect error:', err.message);
    res.status(500).json({ error: 'failed to complete connection' });
  }
});

module.exports = router;
