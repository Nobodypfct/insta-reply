const { Telegraf } = require('telegraf');
const { state } = require('./store');

const { TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID } = process.env;

function startBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN не задан — телеграм-бот не запущен');
    return;
  }

  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  // простая защита: реагируем только на заданный ADMIN_CHAT_ID,
  // чтобы посторонние не могли управлять твоим инста-аккаунтом
  bot.use((ctx, next) => {
    if (ADMIN_CHAT_ID && String(ctx.chat?.id) !== String(ADMIN_CHAT_ID)) {
      return ctx.reply('У тебя нет доступа к этому боту.');
    }
    return next();
  });

  bot.command('start', (ctx) => {
    ctx.reply(
      'Привет! Это пульт управления Insta-Reply.\n\n' +
      'Подключение Instagram:\n' +
      '/setig ТОКЕН ID — подключить свой Instagram-аккаунт\n' +
      '/igstatus — проверить, подключен ли Instagram\n\n' +
      'Управление автоответчиком:\n' +
      '/status — статус и статистика\n' +
      '/on — включить автоответчик\n' +
      '/off — выключить автоответчик\n' +
      '/templates — показать текущие фразы для ответа на комментарии\n' +
      '/addtemplate текст — добавить новую фразу\n' +
      '/dm текст — изменить текст сообщения в директ\n' +
      '/help — показать это сообщение'
    );
  });
  bot.command('help', (ctx) => ctx.reply('Смотри /start — там весь список команд.'));

  bot.command('igstatus', (ctx) => {
    const { pageAccessToken, igBusinessId } = state.ig;
    if (pageAccessToken && igBusinessId) {
      ctx.reply(
        `✅ Instagram подключен\n\n` +
        `IG Business ID: ${igBusinessId}\n` +
        `Токен: ${pageAccessToken.slice(0, 8)}...${pageAccessToken.slice(-4)} (скрыт)`
      );
    } else {
      ctx.reply(
        '❌ Instagram еще не подключен.\n\n' +
        'Подключи командой:\n/setig ТОКЕН ID\n\n' +
        'Где взять токен и id — смотри в README, раздел "как подключить Instagram".'
      );
    }
  });

  bot.command('setig', (ctx) => {
    const args = ctx.message.text.replace('/setig', '').trim().split(/\s+/);
    if (args.length < 2 || !args[0]) {
      return ctx.reply(
        'Формат команды:\n/setig ТОКЕН ID\n\n' +
        'Например:\n/setig EAAxxxxxxxxxx 17841400000000000\n\n' +
        'Токен и id берутся в Graph API Explorer, см. README.'
      );
    }
    const [pageAccessToken, igBusinessId] = args;
    state.ig.pageAccessToken = pageAccessToken;
    state.ig.igBusinessId = igBusinessId;
    ctx.reply('✅ Instagram подключен! Проверить можно командой /igstatus');
  });

  bot.command('status', (ctx) => {
    const s = state.stats;
    const lastActivity = s.lastActivityAt
      ? new Date(s.lastActivityAt).toLocaleString('ru-RU')
      : 'пока не было';

    ctx.reply(
      `Статус: ${state.enabled ? '🟢 включен' : '🔴 выключен'}\n\n` +
      `Обработано комментариев: ${s.commentsProcessed}\n` +
      `Отправлено DM: ${s.dmsSent}\n` +
      `Последняя активность: ${lastActivity}`
    );
  });

  bot.command('on', (ctx) => {
    state.enabled = true;
    ctx.reply('✅ Автоответчик включен.');
  });

  bot.command('off', (ctx) => {
    state.enabled = false;
    ctx.reply('⏸ Автоответчик выключен. Комментарии не будут обрабатываться.');
  });

  bot.command('templates', (ctx) => {
    const list = state.replyTemplates
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n');
    ctx.reply(`Текущие фразы для ответа на комментарии:\n\n${list}`);
  });

  bot.command('addtemplate', (ctx) => {
    const text = ctx.message.text.replace('/addtemplate', '').trim();
    if (!text) {
      return ctx.reply('Напиши текст после команды, например:\n/addtemplate Спасибо, лови в директе!');
    }
    state.replyTemplates.push(text);
    ctx.reply(`Добавлено. Теперь фраз: ${state.replyTemplates.length}`);
  });

  bot.command('dm', (ctx) => {
    const text = ctx.message.text.replace('/dm', '').trim();
    if (!text) {
      return ctx.reply(`Текущий текст DM:\n\n${state.dmText}\n\nЧтобы изменить, напиши:\n/dm новый текст`);
    }
    state.dmText = text;
    ctx.reply('✅ Текст DM обновлен.');
  });

  bot.launch();
  console.log('телеграм-бот запущен');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startBot };
