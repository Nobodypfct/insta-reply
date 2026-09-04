const igAccountRepo = require('../repositories/igAccount.repository');
const templateRepo = require('../repositories/template.repository');
const activityLogRepo = require('../repositories/activityLog.repository');
const conversationStateRepo = require('../repositories/conversationState.repository');
const templateEventRepo = require('../repositories/templateEvent.repository');
const instagramService = require('./instagram.service');
const redirectLink = require('../lib/redirectLink');

// сколько раз максимум переспрашиваем "ты точно подписался?" прежде чем сдаться
const MAX_FOLLOW_CONFIRM_ATTEMPTS = 2;

// запасные тексты, если юзер не заполнил поля шаблона
const FALLBACK_NOT_FOLLOWING =
  'Подпишись на аккаунт, чтобы получить материал, и нажми кнопку ниже 👇';
const FALLBACK_AFTER_FOLLOW = 'Спасибо за подписку! Держи 🎉';

// отправляет "финальное" сообщение шаблона - единственное сообщение при
// отсутствии require_follow_check, либо reward после подтверждения подписки.
// Если у шаблона задана кнопка-ссылка (link_button_url) - шлёт её web_url-
// кнопкой через редирект-сервис (lib/redirectLink.js) и логирует событие
// "link_sent" в аналитику; иначе - просто текст. Используется и для
// comment-, и для dm-шаблонов - поле общее, sendReward уже origin-agnostic
// (см. handlePostback), несимметрично оставлять только comment-ветку.
//
// recipient: строка (id, consent уже есть) ИЛИ { comment_id } (первое
// сообщение свежему комментатору, см. грабли #2 в CLAUDE.md).
async function sendFinalMessage(igAccount, template, recipient, text) {
  const redirectUrl = template.link_button_url
    ? redirectLink.buildRedirectUrl(template.id)
    : null;

  if (redirectUrl && template.link_button_text) {
    const ok = await instagramService.sendLinkButtonMessage(
      igAccount.page_access_token,
      igAccount.ig_business_id,
      recipient,
      text,
      template.link_button_text,
      redirectUrl
    );
    if (ok) await templateEventRepo.log(template.id, 'link_sent');
    return ok;
  }

  if (template.link_button_url && !redirectUrl) {
    // BACKEND_URL не настроен - деградация, не hard-fail: шлём без кнопки
    console.warn(`BACKEND_URL не настроен - шаблон ${template.id} отправлен без кнопки-ссылки`);
  }

  if (recipient && typeof recipient === 'object' && recipient.comment_id) {
    return instagramService.sendDirectMessage(
      igAccount.page_access_token,
      igAccount.ig_business_id,
      recipient.comment_id,
      text
    );
  }
  return instagramService.sendTextMessage(
    igAccount.page_access_token,
    igAccount.ig_business_id,
    recipient,
    text
  );
}

// обрабатывает одно событие "новый комментарий" из вебхука:
// находит владельца, подбирает подходящий шаблон (по посту/keyword),
// отвечает, шлёт DM, логирует активность
async function handleNewComment(igBusinessId, commentData) {
  const commentId = commentData.id;
  const fromUserId = commentData.from?.id;
  const fromUsername = commentData.from?.username;
  const text = commentData.text;
  const postId = commentData.media?.id;

  if (!commentId || !fromUserId) return;

  const igAccount = await igAccountRepo.findByBusinessId(igBusinessId);
  if (!igAccount) {
    console.log(`ig account ${igBusinessId} not found in db, skipping`);
    return;
  }

  // защита от петли: игнорируем комментарии от самого себя (наши же ответы)
  if (fromUserId === igAccount.ig_business_id) {
    console.log(`skipping own comment ${commentId} (avoiding reply loop)`);
    return;
  }

  if (!igAccount.webhook_enabled) {
    console.log(`webhook disabled for ${igAccount.username}, skipping`);
    return;
  }

  console.log(`[${igAccount.username}] new comment ${commentId} from ${fromUserId}: "${text}"`);

  const templates = await templateRepo.findActiveByAccount(igAccount.id, 'comment');
  const matched = templateRepo.matchTemplate(templates, { postId, commentText: text });

  if (!matched) {
    console.log(`no matching template for comment ${commentId} (post ${postId}), skipping`);
    return;
  }

  // аналитика: шаблон сработал на этот коммент - вход в воронку.
  // Только comment-шаблоны (задача так и называлась) - у dm-шаблонов
  // старта в этом смысле не определено, только link_sent/link_clicked
  // (они текут через sendFinalMessage, общий с comment-веткой)
  await templateEventRepo.log(matched.id, 'started');

  const replyText = templateRepo.pickRandomReply(matched);
  const replySuccess = await instagramService.replyToComment(
    igAccount.page_access_token,
    commentId,
    replyText
  );

  let dmSuccess;

  if (matched.require_follow_check === true) {
    // сценарий "проверка подписки": вместо обычного DM шлём сообщение с
    // кнопкой и заводим состояние диалога. Проверка подписки будет позже,
    // после клика по кнопке (только тогда появляется "user consent")
    // первое сообщение свежему комментатору - только через comment_id
    dmSuccess = await instagramService.sendButtonMessage(
      igAccount.page_access_token,
      igAccount.ig_business_id,
      { comment_id: commentId },
      matched.dm_text,
      matched.button_text_initial || 'Получить',
      String(matched.id)
    );

    await conversationStateRepo.create({
      igAccountId: igAccount.id,
      commenterId: fromUserId,
      templateId: matched.id,
    });
  } else {
    // финальное (и единственное) сообщение сразу - через общий sendFinalMessage,
    // чтобы кнопка-ссылка (если задана) ушла и залогировалась
    dmSuccess = await sendFinalMessage(igAccount, matched, { comment_id: commentId }, matched.dm_text);
  }

  await activityLogRepo.log({
    igAccountId: igAccount.id,
    commentId,
    commenterId: fromUserId,
    commenterUsername: fromUsername,
    commentText: text,
    postId,
    repliedAt: replySuccess ? new Date().toISOString() : null,
    dmSentAt: dmSuccess ? new Date().toISOString() : null,
    dmSuccess,
  });
}

// шлёт финальную "награду" и закрывает диалог
async function sendReward(igAccount, state, template, recipientId) {
  await sendFinalMessage(
    igAccount,
    template,
    recipientId,
    template.message_after_follow || FALLBACK_AFTER_FOLLOW
  );
  await conversationStateRepo.updateStatus(state.id, 'completed');
  console.log(`[${igAccount.username}] conversation ${state.id} -> completed (reward sent)`);
}

// шлёт "ты не подписан" с кнопкой "Я подписался"
async function askToFollow(igAccount, template, recipientId) {
  return instagramService.sendButtonMessage(
    igAccount.page_access_token,
    igAccount.ig_business_id,
    recipientId,
    template.message_if_not_following || FALLBACK_NOT_FOLLOWING,
    template.button_text_follow_confirm || 'Я подписался',
    String(template.id)
  );
}

// обрабатывает клик по кнопке в DM (вебхук messaging_postbacks).
// именно здесь есть "user consent" - можно проверять is_user_follow_business
async function handlePostback(igBusinessId, senderId, payload) {
  if (!igBusinessId || !senderId) return;

  const igAccount = await igAccountRepo.findByBusinessId(igBusinessId);
  if (!igAccount) {
    console.log(`ig account ${igBusinessId} not found for postback, skipping`);
    return;
  }

  const state = await conversationStateRepo.findByAccountAndCommenter(igAccount.id, senderId);
  if (!state) {
    // в норме не должно случаться: postback без заведённого состояния
    console.log(`no conversation state for ${senderId} on ${igAccount.username}, ignoring postback (payload="${payload}")`);
    return;
  }

  if (state.status === 'completed') {
    console.log(`[${igAccount.username}] conversation ${state.id} already completed, ignoring postback`);
    return;
  }

  const template = await templateRepo.findById(state.template_id);
  if (!template) {
    console.log(`template ${state.template_id} for conversation ${state.id} not found, skipping`);
    return;
  }

  const isFollower = await instagramService.checkIsFollower(igAccount.page_access_token, senderId);
  console.log(`[${igAccount.username}] follow check for ${senderId}: ${isFollower} (status=${state.status})`);

  if (isFollower === true) {
    await sendReward(igAccount, state, template, senderId);
    return;
  }

  // isFollower === false | null ("не подписан" либо "неизвестно" - ведём одинаково)
  if (state.status === 'awaiting_initial_click') {
    await askToFollow(igAccount, template, senderId);
    await conversationStateRepo.updateStatus(state.id, 'awaiting_follow_confirmation');
    console.log(`[${igAccount.username}] conversation ${state.id} -> awaiting_follow_confirmation`);
    return;
  }

  if (state.status === 'awaiting_follow_confirmation') {
    if (state.follow_confirm_attempts >= MAX_FOLLOW_CONFIRM_ATTEMPTS) {
      console.log(`[${igAccount.username}] conversation ${state.id} hit max follow-confirm attempts, giving up`);
      return;
    }
    await askToFollow(igAccount, template, senderId);
    await conversationStateRepo.bumpFollowConfirmAttempts(
      state.id,
      state.follow_confirm_attempts + 1
    );
    console.log(`[${igAccount.username}] conversation ${state.id} re-asked to follow (attempt ${state.follow_confirm_attempts + 1})`);
    return;
  }

  console.log(`[${igAccount.username}] conversation ${state.id} in unexpected status "${state.status}", ignoring`);
}

// обрабатывает входящее DM-сообщение (вебхук messages, НЕ postback и НЕ echo -
// оба уже отфильтрованы в webhook.routes.js, но проверка сендера ниже -
// дополнительная подстраховка от реплай-петли, как и для комментариев).
// Подбирает dm-шаблон по keyword/exact_match, шлёт ответ той же механикой,
// что comment-шаблоны: без require_follow_check - сразу текст, с ним -
// кнопка + conversation_state (дальше ведёт handlePostback - ему всё равно,
// с чего начался диалог, с коммента или с DM).
//
// В отличие от handleNewComment: юзер уже написал нам сам, consent на
// отправку по id уже есть - comment_id тут не нужен и невозможен (у входящего
// DM его просто нет).
async function handleIncomingDm(igBusinessId, senderId, messageText) {
  if (!igBusinessId || !senderId) return;

  const igAccount = await igAccountRepo.findByBusinessId(igBusinessId);
  if (!igAccount) {
    console.log(`ig account ${igBusinessId} not found for incoming dm, skipping`);
    return;
  }

  // защита от петли: не отвечаем сами себе
  if (senderId === igAccount.ig_business_id) {
    console.log(`skipping own dm from ${senderId} (avoiding reply loop)`);
    return;
  }

  if (!igAccount.webhook_enabled) {
    console.log(`webhook disabled for ${igAccount.username}, skipping dm`);
    return;
  }

  console.log(`[${igAccount.username}] incoming dm from ${senderId}: "${messageText}"`);

  const templates = await templateRepo.findActiveByAccount(igAccount.id, 'dm');
  const matched = templateRepo.matchDmTemplate(templates, messageText);

  if (!matched) {
    console.log(`no matching dm template for ${senderId}, skipping`);
    return;
  }

  if (matched.require_follow_check === true) {
    await instagramService.sendButtonMessage(
      igAccount.page_access_token,
      igAccount.ig_business_id,
      senderId,
      matched.dm_text,
      matched.button_text_initial || 'Получить',
      String(matched.id)
    );

    await conversationStateRepo.create({
      igAccountId: igAccount.id,
      commenterId: senderId,
      templateId: matched.id,
    });
    return;
  }

  await sendFinalMessage(igAccount, matched, senderId, matched.dm_text);
}

module.exports = { handleNewComment, handlePostback, handleIncomingDm };
