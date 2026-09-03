const express = require('express');
const igAccountRepo = require('../repositories/igAccount.repository');
const igAccountService = require('../services/igAccount.service');
const oauthService = require('../services/oauth.service');
const instagramService = require('../services/instagram.service');

const router = express.Router();

// список подключённых аккаунтов юзера - для дашборда.
// avatar_url при необходимости лениво обновляется из Graph API (см.
// igAccount.service.js) - не чаще раза в 24ч на аккаунт
router.get('/api/ig-accounts', async (req, res) => {
  const { user_id: userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'missing user_id' });

  const accounts = await igAccountService.listForUser(userId);
  res.json({ accounts });
});

// последние посты конкретного аккаунта - для выбора поста при создании шаблона
router.get('/api/ig-accounts/:igAccountId/media', async (req, res) => {
  const { igAccountId } = req.params;

  const account = await igAccountRepo.findById(igAccountId);
  if (!account) return res.status(404).json({ error: 'account not found' });

  try {
    const media = await instagramService.getRecentMedia(account.page_access_token, account.ig_business_id);
    res.json({ media });
  } catch (err) {
    console.error('get media error:', err.response?.data || err.message);
    res.status(500).json({ error: 'failed to fetch media' });
  }
});

// принимает long-lived токен, полученный на фронтенде через Auth.js,
// сохраняет аккаунт и подписывает на вебхуки
router.post('/api/complete-instagram-connect', async (req, res) => {
  const {
    user_id: userId,
    long_lived_token: longLivedToken,
    profile_picture_url: profilePictureUrl,
    force_transfer: forceTransfer,
  } = req.body;

  if (!userId || !longLivedToken) {
    return res.status(400).json({ error: 'missing required fields' });
  }

  try {
    const result = await oauthService.completeConnection({
      userId,
      longLivedToken,
      profilePictureUrl,
      forceTransfer: forceTransfer === true,
    });

    if (result.conflict) {
      return res.status(409).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('complete-instagram-connect error:', err.response?.data || err.message);
    res.status(500).json({ error: 'failed to complete connection' });
  }
});

module.exports = router;
