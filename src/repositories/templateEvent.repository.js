const supabase = require('../lib/supabase');

const EVENT_TYPES = ['started', 'link_sent', 'link_clicked'];

function zeroStats() {
  return { started: 0, link_sent: 0, link_clicked: 0 };
}

// логирует одно событие воронки шаблона. Fire-and-forget по духу (как
// activityLogRepo.log) - ошибка логирования не должна ронять отправку
// сообщения/редирект, только громкий console.error
async function log(templateId, eventType) {
  const { error } = await supabase
    .from('template_events')
    .insert({ template_id: templateId, event_type: eventType });

  if (error) {
    console.error(`templateEvent.log error (template ${templateId}, ${eventType}):`, error.message);
  }
}

// агрегат "за всё время" сразу по нескольким шаблонам - один запрос вместо
// N (для списка шаблонов аккаунта). Считаем в JS, а не через SQL group by
// (как matchTemplate/pickRandomReply в этом проекте - postgrest-клиент для
// агрегации в SQL неудобен). Всегда возвращает запись для каждого id из
// templateIds, даже если событий 0 - фронту не нужно самому мержить дыры.
async function countsByTemplateIds(templateIds) {
  const result = {};
  for (const id of templateIds) result[id] = zeroStats();
  if (templateIds.length === 0) return result;

  const { data, error } = await supabase
    .from('template_events')
    .select('template_id, event_type')
    .in('template_id', templateIds);

  if (error) {
    console.error('templateEvent.countsByTemplateIds error:', error.message);
    return result;
  }

  for (const row of data) {
    if (result[row.template_id] && EVENT_TYPES.includes(row.event_type)) {
      result[row.template_id][row.event_type] += 1;
    }
  }
  return result;
}

module.exports = { log, countsByTemplateIds, zeroStats, EVENT_TYPES };
