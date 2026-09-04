const express = require('express');
const templateRepo = require('../repositories/template.repository');
const {
  requireIgAccountOwnership,
  requireTemplateOwnership,
} = require('../middleware/ownership');

const router = express.Router();

// 409-ответ: у аккаунта уже есть шаблон на "любой пост" (post_id IS NULL).
// поле верхнего уровня именно "code" - фронт читает json.code как константу
const ANY_POST_CONFLICT = {
  code: 'any_post_template_exists',
  message: 'У этого аккаунта уже есть шаблон на «любой пост».',
};

// список шаблонов конкретного подключённого аккаунта
router.get(
  '/api/ig-accounts/:igAccountId/templates',
  requireIgAccountOwnership,
  async (req, res) => {
    const templates = await templateRepo.findAllByAccount(req.params.igAccountId);
    res.json({ templates });
  }
);

// создать новый шаблон
// body: { type?: "comment"|"dm", postId?, keyword?, dmText, replyTexts: string[], ... }
// type по умолчанию "comment" (обратная совместимость - старый фронт его не шлёт)
router.post('/api/ig-accounts/:igAccountId/templates', requireIgAccountOwnership, async (req, res) => {
  const { igAccountId } = req.params;
  const {
    type,
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
    links,
    exactMatch,
  } = req.body;

  const resolvedType = type === 'dm' ? 'dm' : 'comment';

  // "вариант ответа" - это публичный комментарий-ответ, у dm-шаблонов его
  // нет (есть только dm_text), поэтому не требуем
  if (resolvedType === 'comment' && (!replyTexts || replyTexts.length === 0)) {
    return res.status(400).json({ error: 'нужен хотя бы один вариант ответа на комментарий' });
  }

  // вторая линия защиты (основная - на фронте): один any-post шаблон на аккаунт.
  // правило касается только comment-шаблонов "на любой пост" - у dm-шаблонов
  // концепции поста нет вообще, их оно не задевает ни как источник, ни как жертва
  if (resolvedType === 'comment' && !postId && (await templateRepo.hasAnyPostTemplate(igAccountId))) {
    return res.status(409).json(ANY_POST_CONFLICT);
  }

  const template = await templateRepo.create({
    igAccountId,
    type,
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
    links,
    exactMatch,
  });
  if (!template) return res.status(500).json({ error: 'не удалось создать шаблон' });

  res.status(201).json({ template });
});

// обновить шаблон (условия срабатывания, dm-текст, вкл/выкл)
router.patch('/api/templates/:templateId', requireTemplateOwnership, async (req, res) => {
  const { templateId } = req.params;
  const {
    type,
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
    links,
    exactMatch,
  } = req.body;

  // тип ПОСЛЕ этого PATCH: явно переданный в запросе, иначе текущий из БД
  // (req.template подгружен в requireTemplateOwnership)
  const effectiveType = type !== undefined ? (type === 'dm' ? 'dm' : 'comment') : req.template.type;

  // если этим PATCH шаблон становится "на любой пост" (postId явно очищается) -
  // проверяем, что у аккаунта нет ДРУГОГО any-post шаблона (себя исключаем).
  // правило касается только comment-шаблонов, см. POST выше
  if (effectiveType === 'comment' && postId !== undefined && !postId) {
    if (await templateRepo.hasAnyPostTemplate(req.template.ig_account_id, templateId)) {
      return res.status(409).json(ANY_POST_CONFLICT);
    }
  }

  const template = await templateRepo.update(templateId, {
    type,
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
    links,
    exactMatch,
  });
  if (!template) return res.status(500).json({ error: 'не удалось обновить шаблон' });

  if (replyTexts) {
    await templateRepo.replaceReplies(templateId, replyTexts);
  }

  res.json({ template });
});

// удалить шаблон
router.delete('/api/templates/:templateId', requireTemplateOwnership, async (req, res) => {
  await templateRepo.remove(req.params.templateId);
  res.status(204).send();
});

module.exports = router;
