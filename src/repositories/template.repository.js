const supabase = require('../lib/supabase');

const DEFAULT_REPLY_TEMPLATES = [
  'Спасибо! Ссылку отправил тебе в директ 🚀',
  'Отправил детали в личку, проверь 📩',
  'Готово, лови в директе!',
];

const DEFAULT_DM_TEXT = 'Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]';

async function getReplyTemplates(igAccountId) {
  const { data, error } = await supabase
    .from('reply_templates')
    .select('text')
    .eq('ig_account_id', igAccountId);

  if (error || !data || data.length === 0) {
    return DEFAULT_REPLY_TEMPLATES;
  }
  return data.map((row) => row.text);
}

async function getDmText(igAccountId) {
  const { data, error } = await supabase
    .from('dm_settings')
    .select('dm_text')
    .eq('ig_account_id', igAccountId)
    .single();

  if (error || !data) return DEFAULT_DM_TEXT;
  return data.dm_text;
}

// вызывается один раз при первом подключении аккаунта - создаёт дефолтные
// шаблоны и dm-текст, если их ещё нет
async function ensureDefaults(igAccountId) {
  const { data: existingTemplates } = await supabase
    .from('reply_templates')
    .select('id')
    .eq('ig_account_id', igAccountId)
    .limit(1);

  if (!existingTemplates || existingTemplates.length === 0) {
    await supabase.from('reply_templates').insert(
      DEFAULT_REPLY_TEMPLATES.map((text) => ({ ig_account_id: igAccountId, text }))
    );
  }

  await supabase
    .from('dm_settings')
    .upsert({ ig_account_id: igAccountId, dm_text: DEFAULT_DM_TEXT }, { onConflict: 'ig_account_id' });
}

// удаляет старые шаблоны/dm-настройки - используется при переносе аккаунта
// другому владельцу, чтобы новый не унаследовал чужие настройки
async function clearForAccount(igAccountId) {
  await supabase.from('reply_templates').delete().eq('ig_account_id', igAccountId);
  await supabase.from('dm_settings').delete().eq('ig_account_id', igAccountId);
}

module.exports = { getReplyTemplates, getDmText, ensureDefaults, clearForAccount };
