const igAccountRepo = require('../repositories/igAccount.repository');
const templateRepo = require('../repositories/template.repository');

// вторая линия после requireAuth: убеждаемся, что ресурс из URL реально
// принадлежит юзеру из токена. service-role клиент видит всё, поэтому
// фильтрацию по владельцу делаем здесь, явно.

function forbidden(res) {
  return res.status(403).json({ code: 'forbidden', message: 'нет доступа к этому ресурсу' });
}

function notFound(res) {
  return res.status(404).json({ code: 'not_found', message: 'ресурс не найден' });
}

// для роутов с :igAccountId - GET/POST .../templates, GET .../media
async function requireIgAccountOwnership(req, res, next) {
  const account = await igAccountRepo.findById(req.params.igAccountId);
  if (!account) return notFound(res);
  if (account.user_id !== req.userId) return forbidden(res);
  req.igAccount = account; // downstream может переиспользовать, без второго запроса
  return next();
}

// для роутов с :templateId - PATCH/DELETE /api/templates/:id.
// у шаблона нет своего user_id, владелец определяется через ig_account
async function requireTemplateOwnership(req, res, next) {
  const template = await templateRepo.findById(req.params.templateId);
  if (!template) return notFound(res);

  const account = await igAccountRepo.findById(template.ig_account_id);
  if (!account || account.user_id !== req.userId) return forbidden(res);

  req.template = template;
  return next();
}

module.exports = { requireIgAccountOwnership, requireTemplateOwnership };
