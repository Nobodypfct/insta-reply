const supabase = require('../lib/supabase');

const DEFAULT_REPLY_TEXTS = [
  'Спасибо! Ссылку отправил тебе в директ 🚀',
  'Отправил детали в личку, проверь 📩',
  'Готово, лови в директе!',
];
const DEFAULT_DM_TEXT = 'Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]';

// ВСЕ шаблоны аккаунта (включая выключенные) вместе с вариантами ответов -
// для отображения в кабинете (юзер сам решает, как показывать is_active)
// и для ensureDefaults (проверка "есть ли вообще хоть один шаблон", иначе
// выключенный единственный шаблон был бы не виден и задублировался бы
// дефолтным при переподключении аккаунта)
async function findAllByAccount(igAccountId) {
  const { data, error } = await supabase
    .from('templates')
    .select('*, template_replies(id, text)')
    .eq('ig_account_id', igAccountId);

  if (error) {
    console.error('template.findAllByAccount error:', error.message);
    return [];
  }
  return data;
}

// только ВКЛЮЧЁННЫЕ шаблоны аккаунта - для подбора шаблона на вебхуке.
// выключенный шаблон не должен участвовать в матчинге комментариев
async function findActiveByAccount(igAccountId) {
  const { data, error } = await supabase
    .from('templates')
    .select('*, template_replies(id, text)')
    .eq('ig_account_id', igAccountId)
    .eq('is_active', true);

  if (error) {
    console.error('template.findActiveByAccount error:', error.message);
    return [];
  }
  return data;
}

// находит подходящий шаблон для конкретного комментария.
// приоритет: 1) пост-специфичный с совпавшим keyword, 2) пост-специфичный
// catch-all (без keyword), 3) "все посты" с совпавшим keyword,
// 4) "все посты" catch-all. Внутри каждой группы шаблоны С keyword всегда
// проверяются раньше catch-all, чтобы более конкретное правило не терялось
// за общим просто из-за порядка в массиве
function matchTemplate(templates, { postId, commentText }) {
  const text = (commentText || '').toLowerCase();
  const matchesKeyword = (tpl) => tpl.keyword && text.includes(tpl.keyword.toLowerCase());
  const isCatchAll = (tpl) => !tpl.keyword;

  const findBest = (scoped) =>
    scoped.find(matchesKeyword) || scoped.find(isCatchAll) || null;

  const postSpecific = templates.filter((t) => t.post_id === postId);
  const postMatch = findBest(postSpecific);
  if (postMatch) return postMatch;

  const allPosts = templates.filter((t) => !t.post_id);
  return findBest(allPosts);
}

function pickRandomReply(template) {
  const variants = template.template_replies?.map((r) => r.text) || [];
  if (variants.length === 0) return DEFAULT_REPLY_TEXTS[0];
  return variants[Math.floor(Math.random() * variants.length)];
}

// опциональные поля шаблона (сценарий "проверка подписки" + кнопка-ссылка
// под финальным сообщением) - задаются только если пришли в запросе,
// иначе полагаемся на дефолты/nullable столбцов в БД.
// link_button_* - это ОБЫЧНАЯ кнопка со ссылкой (открывает URL), не путать
// с button_text_initial/button_text_follow_confirm (postback, триггерят
// следующее сообщение бота). Пустая строка "" = кнопки нет, так и храним.
function applyOptionalTemplateFields(target, src) {
  const {
    requireFollowCheck,
    buttonTextInitial,
    messageIfNotFollowing,
    buttonTextFollowConfirm,
    messageAfterFollow,
    linkButtonText,
    linkButtonUrl,
  } = src;
  if (requireFollowCheck !== undefined) target.require_follow_check = !!requireFollowCheck;
  if (buttonTextInitial !== undefined) target.button_text_initial = buttonTextInitial;
  if (messageIfNotFollowing !== undefined) target.message_if_not_following = messageIfNotFollowing;
  if (buttonTextFollowConfirm !== undefined) target.button_text_follow_confirm = buttonTextFollowConfirm;
  if (messageAfterFollow !== undefined) target.message_after_follow = messageAfterFollow;
  if (linkButtonText !== undefined) target.link_button_text = linkButtonText;
  if (linkButtonUrl !== undefined) target.link_button_url = linkButtonUrl;
}

// есть ли у аккаунта хоть один шаблон на "любой пост" (post_id IS NULL).
// правило blanket: is_active и keyword не важны, любой такой шаблон
// делает слот занятым. exceptId исключается из проверки - это сам
// редактируемый шаблон при PATCH, чтобы any-post шаблон не конфликтовал
// сам с собой. При ошибке запроса возвращаем false (вторая линия защиты,
// основная - на фронте; лучше пропустить, чем ложно отклонить).
async function hasAnyPostTemplate(igAccountId, exceptId = null) {
  let query = supabase
    .from('templates')
    .select('id')
    .eq('ig_account_id', igAccountId)
    .is('post_id', null);

  if (exceptId) query = query.neq('id', exceptId);

  const { data, error } = await query.limit(1);

  if (error) {
    console.error('template.hasAnyPostTemplate error:', error.message);
    return false;
  }
  return data.length > 0;
}

// получить один шаблон по id вместе с вариантами ответов -
// нужно вебхуку postback'ов, где на руках только template_id из состояния
async function findById(templateId) {
  const { data, error } = await supabase
    .from('templates')
    .select('*, template_replies(id, text)')
    .eq('id', templateId)
    .single();

  if (error) {
    console.error('template.findById error:', error.message);
    return null;
  }
  return data;
}

// создать новый шаблон с вариантами ответов
async function create({ igAccountId, postId, keyword, dmText, replyTexts, ...rest }) {
  const insert = {
    ig_account_id: igAccountId,
    post_id: postId || null,
    keyword: keyword || null,
    dm_text: dmText || DEFAULT_DM_TEXT,
  };
  applyOptionalTemplateFields(insert, rest);

  const { data: template, error } = await supabase
    .from('templates')
    .insert(insert)
    .select()
    .single();

  if (error) {
    console.error('template.create error:', error.message);
    return null;
  }

  const texts = replyTexts?.length ? replyTexts : DEFAULT_REPLY_TEXTS;
  await supabase
    .from('template_replies')
    .insert(texts.map((text) => ({ template_id: template.id, text })));

  return template;
}

async function update(templateId, { postId, keyword, dmText, isActive, ...rest }) {
  const patch = {};
  if (postId !== undefined) patch.post_id = postId || null;
  if (keyword !== undefined) patch.keyword = keyword || null;
  if (dmText !== undefined) patch.dm_text = dmText;
  if (isActive !== undefined) patch.is_active = isActive;
  applyOptionalTemplateFields(patch, rest);

  const { data, error } = await supabase
    .from('templates')
    .update(patch)
    .eq('id', templateId)
    .select()
    .single();

  if (error) {
    console.error('template.update error:', error.message);
    return null;
  }
  return data;
}

async function replaceReplies(templateId, replyTexts) {
  await supabase.from('template_replies').delete().eq('template_id', templateId);
  if (replyTexts?.length) {
    await supabase
      .from('template_replies')
      .insert(replyTexts.map((text) => ({ template_id: templateId, text })));
  }
}

async function remove(templateId) {
  const { error } = await supabase.from('templates').delete().eq('id', templateId);
  if (error) console.error('template.remove error:', error.message);
}

// создаёт дефолтный шаблон "на все посты, без keyword" при первом подключении
// аккаунта - сохраняет привычное поведение "отвечать на всё" из коробки
async function ensureDefaults(igAccountId) {
  const existing = await findAllByAccount(igAccountId);
  if (existing.length > 0) return;

  await create({
    igAccountId,
    postId: null,
    keyword: null,
    dmText: DEFAULT_DM_TEXT,
    replyTexts: DEFAULT_REPLY_TEXTS,
  });
}

async function clearForAccount(igAccountId) {
  const { data: templates } = await supabase
    .from('templates')
    .select('id')
    .eq('ig_account_id', igAccountId);

  if (templates?.length) {
    const ids = templates.map((t) => t.id);
    await supabase.from('templates').delete().in('id', ids);
    // template_replies удалятся каскадно через on delete cascade
  }
}

module.exports = {
  findAllByAccount,
  findActiveByAccount,
  findById,
  hasAnyPostTemplate,
  matchTemplate,
  pickRandomReply,
  create,
  update,
  replaceReplies,
  remove,
  ensureDefaults,
  clearForAccount,
};
