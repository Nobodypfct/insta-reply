const express = require('express');
const templateRepo = require('../repositories/template.repository');
const igAccountRepo = require('../repositories/igAccount.repository');

const router = express.Router();

// список шаблонов конкретного подключённого аккаунта
router.get('/api/ig-accounts/:igAccountId/templates', async (req, res) => {
  const { igAccountId } = req.params;
  const templates = await templateRepo.findAllByAccount(igAccountId);
  res.json({ templates });
});

// создать новый шаблон
// body: { postId?, keyword?, dmText, replyTexts: string[] }
router.post('/api/ig-accounts/:igAccountId/templates', async (req, res) => {
  const { igAccountId } = req.params;
  const {
    postId,
    keyword,
    dmText,
    replyTexts,
    requireFollowCheck,
    buttonTextInitial,
    messageIfNotFollowing,
    buttonTextFollowConfirm,
    messageAfterFollow,
  } = req.body;

  if (!replyTexts || replyTexts.length === 0) {
    return res.status(400).json({ error: 'нужен хотя бы один вариант ответа на комментарий' });
  }

  const template = await templateRepo.create({
    igAccountId,
    postId,
    keyword,
    dmText,
    replyTexts,
    requireFollowCheck,
    buttonTextInitial,
    messageIfNotFollowing,
    buttonTextFollowConfirm,
    messageAfterFollow,
  });
  if (!template) return res.status(500).json({ error: 'не удалось создать шаблон' });

  res.status(201).json({ template });
});

// обновить шаблон (условия срабатывания, dm-текст, вкл/выкл)
router.patch('/api/templates/:templateId', async (req, res) => {
  const { templateId } = req.params;
  const {
    postId,
    keyword,
    dmText,
    isActive,
    replyTexts,
    requireFollowCheck,
    buttonTextInitial,
    messageIfNotFollowing,
    buttonTextFollowConfirm,
    messageAfterFollow,
  } = req.body;

  const template = await templateRepo.update(templateId, {
    postId,
    keyword,
    dmText,
    isActive,
    requireFollowCheck,
    buttonTextInitial,
    messageIfNotFollowing,
    buttonTextFollowConfirm,
    messageAfterFollow,
  });
  if (!template) return res.status(500).json({ error: 'не удалось обновить шаблон' });

  if (replyTexts) {
    await templateRepo.replaceReplies(templateId, replyTexts);
  }

  res.json({ template });
});

// удалить шаблон
router.delete('/api/templates/:templateId', async (req, res) => {
  await templateRepo.remove(req.params.templateId);
  res.status(204).send();
});

module.exports = router;
