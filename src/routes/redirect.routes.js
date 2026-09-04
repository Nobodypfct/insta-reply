const express = require('express');
const templateRepo = require('../repositories/template.repository');
const templateEventRepo = require('../repositories/templateEvent.repository');

const router = express.Router();

// публичный редирект для кнопок-ссылок в DM (link_button_url). Instagram НЕ
// шлёт вебхук на клик по web_url-кнопке (в отличие от postback) - это
// единственный способ узнать, что по ссылке кликнули: заворачиваем реальный
// URL в {BACKEND_URL}/r/<templateId> перед отправкой (см. webhook.service.js
// ::sendFinalMessage), тут логируем клик и 302 на настоящий адрес.
//
// Без auth: клиент - анонимный юзер Instagram, у него нет и не может быть
// Supabase-сессии. Не open-redirect: URL назначения берётся из БД по id
// шаблона (задан владельцем шаблона заранее), не из параметров запроса.
router.get('/r/:templateId', async (req, res) => {
  const template = await templateRepo.findById(req.params.templateId);

  if (!template || !template.link_button_url) {
    return res.status(404).send('Ссылка не найдена');
  }

  await templateEventRepo.log(template.id, 'link_clicked');
  res.redirect(302, template.link_button_url);
});

module.exports = router;
