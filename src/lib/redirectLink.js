const env = require('../config/env');

// оборачивает реальный URL кнопки-ссылки в наш редирект-сервис
// (GET /r/:templateId, см. routes/redirect.routes.js). Instagram НЕ шлёт
// вебхук на клик по web_url-кнопке (в отличие от postback-кнопок) -
// собственный редирект с логированием клика перед 302 на реальный урл
// это единственный способ узнать, что по ссылке кликнули.
//
// возвращает null, если BACKEND_URL не настроен - вызывающий код тогда
// откатывается на отправку обычным текстом, без кнопки (см.
// webhook.service.js::sendFinalMessage). Не hard-fail всего сервера -
// это деградация одной фичи, не проблема безопасности.
function buildRedirectUrl(templateId) {
  if (!env.backendUrl) return null;
  return `${env.backendUrl}/r/${templateId}`;
}

module.exports = { buildRedirectUrl };
