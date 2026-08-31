const supabase = require('../lib/supabase');

async function log({
  igAccountId,
  commentId,
  commenterId,
  commenterUsername,
  commentText,
  postId,
  repliedAt,
  dmSentAt,
  dmSuccess,
}) {
  const { error } = await supabase.from('activity_log').insert({
    ig_account_id: igAccountId,
    comment_id: commentId,
    commenter_id: commenterId,
    commenter_username: commenterUsername || null,
    comment_text: commentText || null,
    post_id: postId || null,
    replied_at: repliedAt || null,
    dm_sent_at: dmSentAt || null,
    dm_success: dmSuccess || false,
  });

  if (error) {
    console.error('activityLog.log error:', error.message);
  }
}

module.exports = { log };
