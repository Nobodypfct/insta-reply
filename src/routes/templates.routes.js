const express = require('express');
const templateRepo = require('../repositories/template.repository');
const igAccountRepo = require('../repositories/igAccount.repository');

const router = express.Router();

// 409-ответ: у аккаунта уже есть шаблон на "любой пост" (post_id IS NULL).
// поле верхнего уровня именно "code" - фронт читает json.code как константу
const ANY_POST_CONFLICT = {
  code: 'any_post_template_exists',
  message: 'У этого аккаунта уже есть шаблон на «любой пост».',
};

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
    linkButtonText,
    linkButtonUrl,
  } = req.body;

  if (!replyTexts || replyTexts.length === 0) {
    return res.status(400).json({ error: 'нужен хотя бы один вариант ответа на комментарий' });
  }

  // вторая линия защиты (основная - на фронте): один any-post шаблон на аккаунт.
  // проверяем только когда новый шаблон сам "на любой пост"
  if (!postId && (await templateRepo.hasAnyPostTemplate(igAccountId))) {
    return res.status(409).json(ANY_POST_CONFLICT);
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
    linkButtonText,
    linkButtonUrl,
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
    linkButtonText,
    linkButtonUrl,
  } = req.body;

  // если этим PATCH шаблон становится "на любой пост" (postId явно очищается) -
  // проверяем, что у аккаунта нет ДРУГОГО any-post шаблона (себя исключаем)
  if (postId !== undefined && !postId) {
    const existing = await templateRepo.findById(templateId);
    if (existing && (await templateRepo.hasAnyPostTemplate(existing.ig_account_id, templateId))) {
      return res.status(409).json(ANY_POST_CONFLICT);
    }
  }

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
    linkButtonText,
    linkButtonUrl,
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
