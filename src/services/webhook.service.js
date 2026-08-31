const igAccountRepo = require('../repositories/igAccount.repository');
const templateRepo = require('../repositories/template.repository');
const activityLogRepo = require('../repositories/activityLog.repository');
const instagramService = require('./instagram.service');

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// обрабатывает одно событие "новый комментарий" из вебхука:
// находит владельца, фильтрует петли/выключенные аккаунты, отвечает,
// шлёт DM, логирует активность
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

  const templates = await templateRepo.getReplyTemplates(igAccount.id);
  const replyText = pickRandom(templates);
  const dmText = await templateRepo.getDmText(igAccount.id);

  const replySuccess = await instagramService.replyToComment(
    igAccount.page_access_token,
    commentId,
    replyText
  );
  const dmSuccess = await instagramService.sendDirectMessage(
    igAccount.page_access_token,
    igAccount.ig_business_id,
    commentId,
    dmText
  );

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

module.exports = { handleNewComment };
