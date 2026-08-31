const axios = require('axios');

const API_VERSION = 'v26.0';
const BASE_URL = `https://graph.instagram.com/${API_VERSION}`;

async function replyToComment(accessToken, commentId, message) {
  try {
    await axios.post(
      `${BASE_URL}/${commentId}/replies`,
      { message },
      { params: { access_token: accessToken } }
    );
    console.log(`replied to comment ${commentId}`);
    return true;
  } catch (err) {
    console.error('reply error:', err.response?.data || err.message);
    return false;
  }
}

async function sendDirectMessage(accessToken, igBusinessId, commentId, message) {
  try {
    await axios.post(
      `${BASE_URL}/${igBusinessId}/messages`,
      {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      { params: { access_token: accessToken } }
    );
    console.log(`sent DM for comment ${commentId}`);
    return true;
  } catch (err) {
    console.error('dm error:', err.response?.data || err.message);
    return false;
  }
}

async function subscribeToWebhooks(accessToken, igBusinessId) {
  await axios.post(`${BASE_URL}/${igBusinessId}/subscribed_apps`, null, {
    params: {
      subscribed_fields: 'comments,messages',
      access_token: accessToken,
    },
  });
}

// узнать id/username подключённого аккаунта по токену.
// возвращает user_id, если есть - это поле совпадает с форматом, который
// Meta присылает в entry.id вебхука (поле id даёт другой формат при
// self-serve OAuth через www.instagram.com/oauth/authorize)
async function getMe(accessToken) {
  const res = await axios.get(`${BASE_URL}/me`, {
    params: { fields: 'id,user_id,username', access_token: accessToken },
  });
  const { id, user_id: userIdField, username } = res.data;
  return { igBusinessId: userIdField || id, username };
}

module.exports = { replyToComment, sendDirectMessage, subscribeToWebhooks, getMe };
