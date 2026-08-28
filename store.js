// простое хранилище в памяти (для MVP достаточно, потом можно вынести в БД)

const state = {
  enabled: true, // вкл/выкл автоответчик целиком
  replyTemplates: [
    'Спасибо! Ссылку отправил тебе в директ 🚀',
    'Отправил детали в личку, проверь 📩',
    'Готово, лови в директе!',
    'Уже в пути, глянь личные сообщения',
    'Скинул тебе в директ, посмотри 👀',
  ],
  dmText: 'Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]',
  // данные для подключения к Instagram — можно задать через .env (по умолчанию)
  // или переопределить прямо из телеграм-бота командой /setig
  ig: {
    pageAccessToken: process.env.PAGE_ACCESS_TOKEN || null,
    igBusinessId: process.env.IG_BUSINESS_ID || null,
  },
  stats: {
    commentsProcessed: 0,
    dmsSent: 0,
    lastActivityAt: null,
  },
};

function pickRandomReply() {
  const list = state.replyTemplates;
  return list[Math.floor(Math.random() * list.length)];
}

function recordActivity() {
  state.stats.commentsProcessed += 1;
  state.stats.dmsSent += 1;
  state.stats.lastActivityAt = new Date().toISOString();
}

module.exports = { state, pickRandomReply, recordActivity };
