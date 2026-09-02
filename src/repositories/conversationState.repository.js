const supabase = require('../lib/supabase');

// одна активная запись на пару (ig_account, комментатор) - гарантируется
// unique-констрейнтом в БД, поэтому здесь можно maybeSingle без страха
async function findByAccountAndCommenter(igAccountId, commenterId) {
  const { data, error } = await supabase
    .from('conversation_states')
    .select('*')
    .eq('ig_account_id', igAccountId)
    .eq('commenter_id', commenterId)
    .maybeSingle();

  if (error) {
    console.error('conversationState.findByAccountAndCommenter error:', error.message);
    return null;
  }
  return data;
}

// создаёт (или сбрасывает, если запись уже была) состояние диалога.
// повторный коммент того же юзера начинает сценарий заново с чистого листа
async function create({ igAccountId, commenterId, templateId }) {
  const { data, error } = await supabase
    .from('conversation_states')
    .upsert(
      {
        ig_account_id: igAccountId,
        commenter_id: commenterId,
        template_id: templateId,
        status: 'awaiting_initial_click',
        follow_confirm_attempts: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'ig_account_id,commenter_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('conversationState.create error:', error.message);
    return null;
  }
  return data;
}

async function updateStatus(id, status) {
  const { data, error } = await supabase
    .from('conversation_states')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('conversationState.updateStatus error:', error.message);
    return null;
  }
  return data;
}

// увеличивает счётчик переспрашиваний про подписку - вызывается, когда
// юзер нажал "Я подписался", но проверка всё ещё возвращает не-true
async function bumpFollowConfirmAttempts(id, attempts) {
  const { error } = await supabase
    .from('conversation_states')
    .update({ follow_confirm_attempts: attempts, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('conversationState.bumpFollowConfirmAttempts error:', error.message);
  }
}

module.exports = {
  findByAccountAndCommenter,
  create,
  updateStatus,
  bumpFollowConfirmAttempts,
};
