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
    console.error('reply error:', err.message);
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
    console.error('dm error:', err.message);
    return false;
  }
}

// отправить обычный текстовый DM по instagram-scoped id получателя.
// в отличие от sendDirectMessage (там recipient: { comment_id }, способ
// написать ПЕРВЫМ автору коммента), тут recipient: { id } - юзер уже
// написал боту / нажал кнопку, так что прямая отправка по id разрешена
async function sendTextMessage(accessToken, igBusinessId, recipientId, message) {
  try {
    await axios.post(
      `${BASE_URL}/${igBusinessId}/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      { params: { access_token: accessToken } }
    );
    console.log(`sent text DM to ${recipientId}`);
    return true;
  } catch (err) {
    console.error('text message error:', err.message);
    return false;
  }
}

// отправить сообщение с одной postback-кнопкой (Button Template).
// обычный текст кнопку не даёт, а postback нужен, чтобы клик прилетел
// вебхуком messaging_postbacks с нашим payload.
// recipient принимает строку (тогда recipient: { id }) ЛИБО объект -
// для ПЕРВОГО сообщения свежему комментатору нужен { comment_id } (см.
// грабли #2 в CLAUDE.md: по id ему написать первым нельзя)
async function sendButtonMessage(accessToken, igBusinessId, recipient, text, buttonText, payload) {
  const recipientObj = typeof recipient === 'string' ? { id: recipient } : recipient;
  try {
    await axios.post(
      `${BASE_URL}/${igBusinessId}/messages`,
      {
        recipient: recipientObj,
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text,
              buttons: [{ type: 'postback', title: buttonText, payload }],
            },
          },
        },
      },
      { params: { access_token: accessToken } }
    );
    console.log(`sent button message to ${JSON.stringify(recipientObj)} (payload="${payload}")`);
    return true;
  } catch (err) {
    console.error('button message error:', err.message);
    return false;
  }
}

// отправить сообщение с одной web_url-кнопкой (обычная кнопка-ссылка,
// открывает URL) - НЕ путать с sendButtonMessage (там postback, триггерит
// вебхук). У web_url-кнопки клика вебхука нет вообще, поэтому url сюда
// всегда должен быть уже обёрнутым редиректом (см. lib/redirectLink.js) -
// иначе клик просто негде залогировать.
// recipient - то же самое, что у sendButtonMessage: строка ИЛИ { comment_id }
async function sendLinkButtonMessage(accessToken, igBusinessId, recipient, text, buttonText, url) {
  const recipientObj = typeof recipient === 'string' ? { id: recipient } : recipient;
  try {
    await axios.post(
      `${BASE_URL}/${igBusinessId}/messages`,
      {
        recipient: recipientObj,
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text,
              buttons: [{ type: 'web_url', title: buttonText, url }],
            },
          },
        },
      },
      { params: { access_token: accessToken } }
    );
    console.log(`sent link button message to ${JSON.stringify(recipientObj)}`);
    return true;
  } catch (err) {
    console.error('link button message error:', err.message);
    return false;
  }
}

// подписан ли юзер на бизнес-аккаунт. ВАЖНО: вызывать ТОЛЬКО после того,
// как юзер сам провзаимодействовал с ботом (написал/нажал кнопку в DM) -
// до этого поле недоступно ("нет user consent") и запрос падает.
// при ошибке возвращаем null ("неизвестно"), НЕ false - это разные случаи
async function checkIsFollower(accessToken, commenterId) {
  try {
    const res = await axios.get(`${BASE_URL}/${commenterId}`, {
      params: { fields: 'is_user_follow_business', access_token: accessToken },
    });
    const value = res.data?.is_user_follow_business;
    return typeof value === 'boolean' ? value : null;
  } catch (err) {
    console.error('checkIsFollower error:', err.message);
    return null;
  }
}

async function subscribeToWebhooks(accessToken, igBusinessId) {
  await axios.post(`${BASE_URL}/${igBusinessId}/subscribed_apps`, null, {
    params: {
      subscribed_fields: 'comments,messages,messaging_postbacks',
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
    params: {
      fields: 'id,user_id,username,profile_picture_url',
      access_token: accessToken,
    },
  });
  const { id, user_id: userIdField, username, profile_picture_url: profilePictureUrl } = res.data;
  return { igBusinessId: userIdField || id, username, profilePictureUrl: profilePictureUrl || null };
}

// свежий profile_picture_url для уже подключённого аккаунта (TTL-рефреш
// аватарки на чтении). URL от Instagram подписанный и с ограниченным TTL,
// поэтому периодически протухает и его надо перезапрашивать.
// НЕ бросает: при любой ошибке (токен отозван, Graph API упал) возвращает
// null - вызывающий код в этом случае отдаёт то, что уже лежит в БД
async function fetchProfilePictureUrl(accessToken) {
  try {
    const res = await axios.get(`${BASE_URL}/me`, {
      params: { fields: 'profile_picture_url', access_token: accessToken },
    });
    return res.data?.profile_picture_url || null;
  } catch (err) {
    console.error('fetchProfilePictureUrl error:', err.message);
    return null;
  }
}

// последние посты аккаунта - для выбора конкретного поста при создании шаблона
async function getRecentMedia(accessToken, igBusinessId, limit = 25) {
  const res = await axios.get(`${BASE_URL}/${igBusinessId}/media`, {
    params: {
      fields: 'id,caption,media_type,thumbnail_url,media_url,permalink,timestamp',
      limit,
      access_token: accessToken,
    },
  });
  return res.data.data || [];
}

module.exports = {
  replyToComment,
  sendDirectMessage,
  sendTextMessage,
  sendButtonMessage,
  sendLinkButtonMessage,
  checkIsFollower,
  subscribeToWebhooks,
  getMe,
  fetchProfilePictureUrl,
  getRecentMedia,
};
