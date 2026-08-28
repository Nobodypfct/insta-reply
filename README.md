# ig-autoresponder — MVP

Сервер принимает вебхук о новом комментарии под постом, отвечает на комментарий
случайной фразой из шаблона и шлет автору DM.

## что уже сделано в коде

- `GET /webhook` — верификация вебхука (meta один раз дергает этот урл при настройке)
- `POST /webhook` — сюда meta шлет события о новых комментариях
- при новом комментарии: рандомный ответ в комментах + DM автору

## что нужно сделать руками (в meta developers), прежде чем это заработает

1. **Facebook-страница + Instagram Business аккаунт**
   - Instagram: Settings → Account type → Professional Account → Business
   - привяжи его к Facebook-странице (Settings → Linked Accounts)

2. **Meta App**
   - зайди на https://developers.facebook.com/apps → Create App → тип "Business"
   - добавь продукты: **Webhooks** и **Instagram Graph API**

3. **Разрешения (Permissions)**
   - запроси `instagram_manage_comments` и `instagram_manage_messages`
   - пока приложение в Development Mode — работает только на аккаунтах,
     которых ты сам добавил как тестеров (Roles → Instagram Testers)
   - чтобы подключать чужие (клиентские) аккаунты — нужен App Review у meta

4. **Page Access Token**
   - Graph API Explorer (developers.facebook.com/tools/explorer)
   - выбери свое приложение → свою страницу → сгенерируй токен
   - убедись что в токене есть нужные permissions (галочки при генерации)
   - вставь токен в `.env` → `PAGE_ACCESS_TOKEN`

5. **Instagram Business Account ID**
   - через Graph API Explorer сделай запрос:
     `GET /me/accounts` → возьми page id
     `GET /{page-id}?fields=instagram_business_account` → это и есть твой `IG_BUSINESS_ID`

## локальный запуск

```bash
npm install
cp .env.example .env
# заполни .env своими значениями
npm start
```

Сервер поднимется на `localhost:3000`. Но meta не может достучаться до localhost —
для локального теста нужен туннель, например [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Возьми https-адрес, который выдаст ngrok (например `https://abc123.ngrok.app`),
и укажи его + `/webhook` как Callback URL в настройках Webhooks в meta developers
(Callback URL: `https://abc123.ngrok.app/webhook`, Verify Token: тот же что в `.env`).

Подпишись на событие **comments** для своей страницы в разделе Webhooks.

## продакшен — куда задеплоить

Для старта достаточно любого дешевого хостинга, которые сами дают https без возни:

- **Railway** (railway.app) — самый простой вариант, деплой из git за пару кликов
- **Render** (render.com) — тоже просто, есть бесплатный тир (но засыпает без трафика)

После деплоя — тот же шаг с Callback URL, только вместо ngrok-адреса указываешь
адрес продакшен-сервера.

## как подключить Instagram

Есть два способа — оба ведут к одному и тому же результату (получить
Page Access Token и Instagram Business ID), просто разное место, куда их вставить.

### способ 1 — через Telegram-бота (удобнее)

После того как получишь токен и id (шаги ниже) — просто напиши боту:

```
/setig EAAxxxxxxxxxxxxxxx 17841400000000000
```

Первое значение — токен, второе — id. Бот сохранит их и сразу начнет работать.
Проверить статус подключения: `/igstatus`

### способ 2 — через .env файл

То же самое, но вставляешь значения в `.env` перед запуском сервера
(`PAGE_ACCESS_TOKEN` и `IG_BUSINESS_ID`).

### где взять токен и id

1. **Facebook-страница + Instagram Business аккаунт**
   - Instagram: Settings → Account type → Professional Account → Business
   - привяжи его к Facebook-странице (Settings → Linked Accounts)

2. **Meta App**
   - https://developers.facebook.com/apps → Create App → тип "Business"
   - добавь продукты: **Webhooks** и **Instagram Graph API**
   - запроси permissions: `instagram_manage_comments`, `instagram_manage_messages`

3. **Page Access Token**
   - Graph API Explorer (developers.facebook.com/tools/explorer)
   - выбери приложение → свою страницу → сгенерируй токен с нужными permissions

4. **Instagram Business Account ID**
   - в том же Graph API Explorer:
     `GET /me/accounts` → возьми page id
     `GET /{page-id}?fields=instagram_business_account` → это и есть id

Дальше — вставляешь оба значения через `/setig` в боте или в `.env`.

> ⚠️ Пока приложение в Development Mode (до App Review в meta) — работает
> только с аккаунтами, добавленными как тестеры. Для реальных клиентов
> понадобится пройти App Review.

## управление через Telegram-бота

Вместо веб-дашборда — пульт управления прямо в Telegram. Бот умеет:

- `/setig ТОКЕН ID` — подключить Instagram (см. раздел выше)
- `/igstatus` — проверить, подключен ли Instagram
- `/status` — статус (вкл/выкл) и статистика (сколько комментов обработано, DM отправлено)
- `/on` / `/off` — включить/выключить автоответчик
- `/templates` — посмотреть текущие фразы для ответа на комментарии
- `/addtemplate текст` — добавить новую фразу в рандомный список
- `/dm текст` — поменять текст сообщения, которое уходит в директ

### как создать самого бота

1. напиши @BotFather в Telegram, команда `/newbot`, следуй инструкциям.
   В конце он выдаст токен — вставь в `.env` → `TELEGRAM_BOT_TOKEN`.

2. узнай свой chat_id — напиши @userinfobot команду `/start`, он покажет твой id.
   Вставь в `.env` → `ADMIN_CHAT_ID`. Это нужно, чтобы только ты мог управлять ботом,
   а не любой человек, который найдет его в поиске.

3. перезапусти сервер (`npm start`) — бот и веб-сервер запускаются вместе, из одного процесса.

4. напиши своему боту `/start` в Telegram — увидишь список команд.
   Дальше подключи Instagram командой `/setig` (см. раздел выше).

### важно про масштабирование

Сейчас это однопользовательская схема — один бот, один admin chat_id, один
Instagram-аккаунт. Когда появятся другие клиенты (не только ты), понадобится:
- своя пара (Telegram chat_id + Instagram account) на каждого клиента
- хранение этого в базе данных, а не в `.env`
- это ровно то же самое дополнение "мультитенантность", что упомянуто ниже

## что дальше (после того как заработает базовый кейс)

- фильтр по ключевым словам в комментарии (отвечать не на всё подряд)
- рейт-лимит / задержка между сообщениями, чтобы не словить 429 при вирусном посте
- база данных для трекинга: сколько комментов обработано, сколько DM ушло
  (пригодится и для дашборда клиентам, и для тебя самого — метрики для питча блогерам)
- мультитенантность: сейчас в .env один токен на один аккаунт,
  для нескольких клиентов нужно хранить токены в БД по account_id
