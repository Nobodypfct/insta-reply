# CLAUDE.md — ig-autoresponder (backend)

Этот файл читает Claude Code при старте работы в этой директории. Держи его в
курсе архитектуры и важных нюансов — это экономит часы на будущих сессиях.

## Что это за проект

Backend для Insta-Reply — SaaS, который автоматически отвечает на комментарии
в Instagram и шлёт DM автору комментария. Мультитенантный: много юзеров, у
каждого может быть несколько подключённых Instagram-аккаунтов.

## Стек

- Node.js + Express
- Supabase (Postgres + Auth) как БД
- Instagram Graph API (новый flow "Instagram API with Instagram Login", НЕ
  старый "Facebook Login for Business")
- Хостинг: Render

## Архитектура

Слоистая (routes → services → repositories), НЕ полный DDD — оправдано
размером проекта.

```
server.js                          — только сборка Express-приложения
src/
  config/env.js                    — все переменные окружения в одном месте
  lib/supabase.js                  — инициализация клиента
  lib/tokenCipher.js               — AES-256-GCM для page_access_token
  lib/redirectLink.js               — оборачивает link_button_url в /r/<id>
  repositories/                    — SQL-запросы, ничего больше
    igAccount.repository.js
    template.repository.js
    templateEvent.repository.js    — time-series воронки шаблона (аналитика)
    conversationState.repository.js — состояние диалога "проверка подписки"
    activityLog.repository.js
  services/                        — бизнес-логика
    instagram.service.js           — все вызовы к Instagram API
    webhook.service.js             — обработка входящего комментария/postback/DM
    oauth.service.js               — завершение OAuth-подключения
    igAccount.service.js           — список аккаунтов + TTL-рефреш аватарки
  middleware/                      — Express-middleware (аутентификация, доступ)
    auth.js                        — проверка Supabase JWT, ставит req.userId
    ownership.js                   — req.userId владеет ресурсом из :id? (IDOR)
    webhookSignature.js            — проверка X-Hub-Signature-256 от Meta
  routes/                          — тонкий HTTP-слой
    webhook.routes.js
    igAccounts.routes.js
    templates.routes.js
    redirect.routes.js             — GET /r/:templateId, публичный, без auth
```

## Команды

- `npm install` — установить зависимости
- `npm start` — запустить сервер
- `node -c <файл>` — быстрая проверка синтаксиса без запуска

## КРИТИЧЕСКИ ВАЖНЫЕ грабли Instagram API (потрачены часы на их поиск)

1. **Домен API**: используй `graph.instagram.com`, НЕ `graph.facebook.com`.
   Токены нового flow (префикс `IGAA...`) не работают с `graph.facebook.com`
   вообще — даёт "Cannot parse access token".

2. **DM новому юзеру**: используй
   `recipient: { comment_id: commentId }`, НЕ `recipient: { id: userId }`.
   Это официальный способ написать первым тому, кто оставил комментарий.

3. **Вебхуки в Development Mode не работают для реальных событий**, только
   кнопка "Test" в дашборде. Приложение обязательно должно быть **Published**
   (Publish в App Dashboard, требует Privacy Policy URL), иначе реальные
   комментарии не долетают до вебхука — тестовые события идут другим путём
   в обход этого ограничения.

4. **ID аккаунта бывает в двух форматах** — `id` и `user_id` из ответа
   `/me` могут ОТЛИЧАТЬСЯ. Вебхук использует формат из поля `user_id`,
   не `id`. Всегда запрашивай `fields=id,user_id,username` и используй
   `user_id || id`.

   **`profile_picture_url` в `/me` РАБОТАЕТ** — проверено curl'ом на
   self-serve OAuth аккаунте (токен `IGAA...`, домен `graph.instagram.com`).
   Была неопределённость, действительно ли это поле доступно новому flow —
   да, доступно. Запрашиваем `fields=id,user_id,username,profile_picture_url`,
   сохраняем в `ig_accounts.avatar_url` (nullable — IG иногда отдаёт без
   аватара). URL с `fbcdn.net` подписанный и с коротким TTL — протухает.

   **Обновление аватарки (TTL-gated, без крона)**: фронт присылает свежий
   `profile_picture_url` в теле `POST /api/complete-instagram-connect` —
   его и сохраняем (приоритет над тем, что вернул `/me`), проставляя
   `avatar_url_updated_at = now()`. На чтении (`GET /api/ig-accounts`,
   сборка шейпа в `igAccount.service.js`) если `avatar_url_updated_at`
   пустой или старше 24ч — делаем ОДИН запрос `/me?fields=profile_picture_url`
   токеном аккаунта, пишем результат в БД. Сбой рефреша (токен отозван,
   Graph API упал) — тихо отдаём то, что в БД (может быть null/протухшее),
   ответ не роняем. Крон/воркер/своё хранилище картинок — сознательно НЕ
   делаем, следующий шаг эскалации при ненадёжности — качать картинку к себе.

5. **Reply-петля**: бот может отвечать сам себе, если не фильтровать
   комментарии от `fromUserId === igAccount.ig_business_id`. Уже реализовано
   в `webhook.service.js`, не убирай эту проверку.

6. **API версия**: используем `v26.0` везде (актуальная на момент разработки).

7. **`instagram_manage_comments` vs `instagram_business_manage_comments`** —
   имена permissions ОТЛИЧАЮТСЯ в разных местах интерфейса meta developers.
   Всегда сверяй с тем, что реально включено в App Dashboard → Permissions
   and features, а не с тем, что написано в сторонних гайдах.

8. **Входящие DM-сообщения** приходят в вебхук `entry.messaging[]` с полем
   `message` (не `postback`) — тот же конверт, что и postback/комменты, поле
   `subscribed_fields` у нас включает `messages` **с самого начала проекта**
   (было в коде ещё до фичи "проверка подписки"), отдельно подписываться
   не нужно — только на App Dashboard → Webhooks проверь, что галка `messages`
   реально стоит (по аналогии с `messaging_postbacks` в своё время).
   **Reply-петля для DM**: сообщение с `message.is_echo === true` — это эхо
   НАШЕГО ЖЕ исходящего сообщения, не входящее. Плюс подстраховка
   `senderId === igAccount.ig_business_id` в `webhook.service.js`. Не убирай
   ни ту, ни другую проверку — без них дубли/петля, как в грабле #5, только
   для DM. Сообщение без `message.text` (стикер/вложение) тоже пропускаем -
   матчить не на что.

9. **"webhook signature mismatch" на ВСЕХ событиях (и comments, и messaging)
   без видимой причины** — почти наверняка `IG_APP_SECRET` на хостинге
   (Render) просто не совпадает с реальным App Secret в Meta (протух после
   regenerate, опечатка при копипасте, не тот env вообще). НЕ путать с
   граблей DM-специфичной — подпись считается по сырым байтам всего тела,
   контент (коммент/DM/postback) на неё не влияет, так что если mismatch
   происходит на ВСЁМ — ищи проблему в секрете, а не в коде обработки
   конкретного типа события. Диагностика без риска спалить секрет в логах:
   временно залогировать при старте `sha256(IG_APP_SECRET).slice(0,12)`
   и сравнить с `printf '%s' 'СЕКРЕТ_ИЗ_META' | shasum -a 256 | cut -c1-12`,
   посчитанным локально из значения, которое реально показывает Meta App
   Dashboard → App Settings → Basic → App Secret → Show. Не совпало —
   вот и причина, вставить правильное значение на Render, редеплой.
   Кейс 2026-09-04: ровно так и оказалось — секрет на Render был не тот.

## Важные решения архитектуры

- **Мультитенантность**: `entry.id` из вебхука = `ig_business_id` аккаунта-
  владельца поста. По нему ищем нужный `ig_account` в БД, не хардкодим.
- **Модель шаблонов**: `templates.type` — `'comment'` (дефолт, старое
  поведение) | `'dm'` (новое: триггер — входящее DM-сообщение, не коммент).
  **Два типа матчатся ПОЛНОСТЬЮ РАЗДЕЛЬНО**, никогда не смешиваются:
  - `type='comment'`: scope (все посты / конкретный пост) + опциональное
    keyword (contains-only), + `template_replies` (варианты ПУБЛИЧНОГО
    ответа на коммент, рандомный выбор). Приоритет матчинга: пост-специфичный
    с keyword → пост-специфичный catch-all → все-посты с keyword →
    все-посты catch-all. Логика в `template.repository.js::matchTemplate`,
    вызывается из `webhook.service.js::handleNewComment` через
    `findActiveByAccount(id, 'comment')`.
  - `type='dm'`: нет scope по посту вообще (у DM его нет). Матчинг —
    `template.repository.js::matchDmTemplate`: keyword (`exact_match=false`,
    дефолт) → contains, как у comment; `exact_match=true` → точное совпадение
    текста сообщения с keyword (после trim+lowercase); без keyword — catch-all.
    `template_replies` НЕ используется (у DM нет публичного ответа, только
    `dm_text`) — `create()` не сеет `DEFAULT_REPLY_TEXTS` для `type='dm'`,
    если `replyTexts` не переданы явно. Есть `links jsonb` (`[{text,url}]`) —
    пока чистый CRUD без логики отправки, как в своё время
    `link_button_text`/`link_button_url` (задел под будущее).
    Вызывается из `webhook.service.js::handleIncomingDm` через
    `findActiveByAccount(id, 'dm')`. Reuse: `require_follow_check` и вся её
    механика (кнопка → postback → `handlePostback` → проверка подписки)
    работает БЕЗ ИЗМЕНЕНИЙ для dm-шаблонов — `handlePostback` не знает и не
    должен знать, стартовал диалог с коммента или с DM. Единственная разница
    с comment-веткой: у DM юзер уже написал нам сам, consent есть сразу,
    поэтому кнопка шлётся по `{ id: senderId }`, а не по `{ comment_id }`
    (та особенность из граблей #2 — только для comment-origin).
  - **Известное ограничение**: `conversation_states` уникален по
    `(ig_account_id, commenter_id)`, без учёта происхождения (коммент/DM).
    Если один и тот же юзер попадёт в follow-check и с comment-, и с
    dm-шаблона, второй диалог перезапишет состояние первого (upsert). Редкий
    кейс, осознанно не чиним — если станет проблемой, решение: добавить
    колонку `source` в уникальный ключ.
  - DM-ответы **не пишутся в `activity_log`** — там `comment_id text not null`,
    у DM его нет. Не баг, просто пока не логируем (лог только у comment-flow).
  **`findAllByAccount` vs `findActiveByAccount`**: не путать — `findAllByAccount`
  отдаёт ВСЕ шаблоны любого типа (включая выключенные), это для
  `GET .../templates` (кабинет должен видеть и уметь включить обратно) и для
  `ensureDefaults` (иначе единственный выключенный шаблон был бы не виден и
  задублировался бы дефолтным при переподключении). `findActiveByAccount(id, type?)`
  фильтрует `is_active = true` (+ `type`, если передан) — используется
  ТОЛЬКО для подбора шаблона на вебхуке, всегда с явным `type`, иначе
  comment- и dm-шаблоны смешаются и один сработает вместо другого.
  Раньше `findAllByAccount` была одна функция с фильтром — из-за неё
  `PATCH .../:id` с `{ isActive: false }` заставлял шаблон пропадать из
  кабинета целиком.
  На аккаунт допустим только ОДИН **comment**-шаблон с `post_id IS NULL`
  ("любой пост"), независимо от `is_active`/`keyword`. **dm-шаблоны это
  правило не касается вообще** — у них нет `post_id`, `hasAnyPostTemplate`
  скоупится по `type='comment'`, а роуты (`templates.routes.js`) проверяют
  конфликт только когда создаваемый/патчимый шаблон сам `type='comment'`.
  При нарушении 409 `{ code: "any_post_template_exists", message }`. Это
  вторая линия защиты, основную держит фронт; при ошибке запроса проверка
  пропускает (fail-open).
- **`templates.name`** — человекочитаемое название для кабинета, nullable,
  чистый CRUD через `applyOptionalTemplateFields`, никакой логики.
- **Аналитика шаблонов (`template_events`)** — time-series, `(template_id,
  event_type, created_at)`, `event_type` ∈ `started | link_sent | link_clicked`.
  Агрегат "за всё время" через `templateEvent.repository.js::countsByTemplateIds`
  (считает в JS из сырых строк, не SQL group by — как `matchTemplate` в этом
  же файле). Отдаётся в ответах `templates.routes.js` как **`template.stats`**
  (`{ started, link_sent, link_clicked }`, snake_case-ключи — соглашение
  camelCase/snake_case ниже это требует, даже если в постановке задачи было
  написано camelCase). GET-список — один запрос на все шаблоны разом, не
  N+1. POST — `stats` нулевой без похода в БД (у нового шаблона событий
  заведомо нет). PATCH — свежий агрегат.
  - `started` логируется в `handleNewComment` сразу после матчинга, **только
    для comment-шаблонов** (задача так и называлась — "аналитика для
    comment-шаблонов"). У dm-шаблонов `started` не определён, `stats.started`
    для них всегда 0, даже если есть `link_sent`/`link_clicked`.
  - `link_sent`/`link_clicked` — **это МОЁ решение сделать их общими для
    обоих типов**, не только comment: `link_sent` логируется в общем
    `webhook.service.js::sendFinalMessage`, который и так уже шарился между
    `handleNewComment` (comment, plain-ветка), `sendReward` в `handlePostback`
    (reward после follow-check, origin-agnostic по дизайну — см. выше) и
    `handleIncomingDm` (dm, plain-ветка). Раз `sendReward` уже одна на оба
    типа, оставлять `link_sent` только для comment означало бы, что
    dm-шаблон С follow-check получает кнопку-ссылку, а БЕЗ follow-check —
    нет, чисто из-за реализации, не по смыслу. Если это неверно понял —
    просто добавить `template.type === 'comment'` гвард в `sendFinalMessage`.
- **Кнопка-ссылка теперь реально отправляется** (раньше `link_button_url`/
  `link_button_text` были чистым CRUD, см. историю). `webhook.service.js::sendFinalMessage`
  — общая точка отправки "финального" сообщения (единственное сообщение без
  follow-check, либо reward). Если `link_button_url` задан — шлёт
  `instagramService.sendLinkButtonMessage` (web_url-кнопка, НЕ postback,
  `sendButtonMessage` для postback не трогали) с URL, обёрнутым через
  `lib/redirectLink.js` в `{BACKEND_URL}/r/<templateId>`; иначе - обычный
  текст (`sendDirectMessage`/`sendTextMessage`, в зависимости от формы
  `recipient` - строка или `{ comment_id }`).
- **Редирект-сервис `GET /r/:templateId`** (`routes/redirect.routes.js`,
  публичный, без auth — юзер Instagram анонимен, Supabase-сессии у него нет
  и не будет). Instagram НЕ шлёт вебхук на клик по web_url-кнопке (только
  postback-кнопки это умеют) — это единственный способ узнать про клик:
  лог `link_clicked` → `302` на настоящий `link_button_url`. **Не
  open-redirect**: URL назначения читается из БД по `templateId`, не из
  параметров запроса. **Важно**: `link_button_url` резолвится ЖИВЬЁМ в
  момент клика, не снапшотится на момент отправки DM — если юзер поменяет
  ссылку в кабинете, все уже разосланные redirect-ссылки поведут по НОВОМУ
  адресу. Осознанный выбор ради простоты (без нужды в отдельной
  per-отправка таблице) — если понадобится точный снапшот на момент
  отправки, это отдельная эскалация.
- **`BACKEND_URL`** (env, `env.js`) — публичный URL этого бэкенда, нужен
  только для сборки redirect-ссылки. **Опционален, НЕ hard-fail** (в
  отличие от остальных критичных переменных) — если не задан, кнопка-ссылка
  просто не отправляется (fallback на текст, `console.warn`), это
  деградация одной фичи, не проблема безопасности.
- **Опциональные поля шаблона** мапятся из camelCase тела запроса в
  snake_case колонки через `template.repository.js::applyOptionalTemplateFields`
  (одно место для create и update). Две группы:
  `require_follow_check` + `button_text_initial` / `message_if_not_following` /
  `button_text_follow_confirm` / `message_after_follow` — сценарий "проверка
  подписки" (postback-кнопки, есть state machine в `webhook.service.js`);
  `link_button_text` / `link_button_url` — обычная кнопка со ссылкой под
  финальным сообщением, БЕЗ логики (чистый CRUD, `""` = кнопки нет).
  Не путать эти две группы.
- **Конфликт владельца аккаунта**: если юзер пытается подключить уже занятый
  `ig_business_id` — НЕ перезаписываем молча, возвращаем 409 с замаскированным
  email текущего владельца, фронтенд показывает подтверждение переноса
  (как у ChatPlace).

## Безопасность

- **Аутентификация всех `/api/*`**: `server.js` вешает `middleware/auth.js`
  на префикс `/api`. Фронт шлёт `Authorization: Bearer <Supabase access token>`.
  Проверка локальная через `jose` + `createRemoteJWKSet` против публичного
  JWKS проекта (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, ключи ES256,
  ротация переживается автоматически). Сверяем `iss`, `aud=authenticated`,
  `exp` и `role==="authenticated"` (последнее отсекает anon/service_role).
  `req.userId = payload.sub`. Ошибка → `401 { code: "unauthorized" }`.
  `/` и `/webhook` — БЕЗ этого middleware (у вебхука своя подпись).
- **`user_id` в запросах больше НЕ принимается** — ни в query, ни в body.
  Личность только из токена (`req.userId`). Не возвращай это поле в контракт.
- **Проверка владельца (IDOR)** — `middleware/ownership.js`. service-role
  клиент видит все строки, поэтому владельца проверяем явно в коде:
  `requireIgAccountOwnership` (роуты с `:igAccountId`) и
  `requireTemplateOwnership` (роуты с `:templateId`, владелец через
  `ig_account`). Чужой ресурс → `403 { code: "forbidden" }`, отсутствует →
  `404 { code: "not_found" }`. Оба кладут найденную запись в
  `req.igAccount` / `req.template`, чтобы роут не делал второй запрос.
  `conversation_states` / `activity_log` трогает только вебхук (без юзера) —
  там проверок нет и не нужно.
- **Подпись вебхука** — `middleware/webhookSignature.js` проверяет
  `X-Hub-Signature-256` (HMAC-SHA256 по сырому телу, ключ `IG_APP_SECRET`,
  `crypto.timingSafeEqual`). Сырое тело берётся из `express.json({ verify })`
  в `server.js` (`req.rawBody`). Несовпадение/отсутствие → `403`, событие
  не обрабатывается. GET-проверку `hub.verify_token` не трогали.
- **`page_access_token` шифруется at rest** — `lib/tokenCipher.js`,
  AES-256-GCM, формат `"v1:<iv>:<tag>:<ciphertext>"` (всё base64), ключ
  `TOKEN_ENC_KEY` (base64 от 32 байт, `openssl rand -base64 32`).
  **Единственная точка** шифрования — `igAccount.repository.js`: `upsert`
  шифрует, `findById` / `findByBusinessId` / `findByUserId` расшифровывают
  (helper `decryptRow`). Слои services/routes про это не знают, получают
  открытый токен. Ошибка расшифровки (не тот ключ, битые данные, plaintext
  до миграции) → `page_access_token: null` + `console.error`, строка НЕ
  роняется (аккаунт ведёт себя как с отозванным токеном). Legacy-passthrough
  НЕТ намеренно — миграция обязательна (см. ниже). Защищает от утечки
  дампа/бэкапа БД и логов; НЕ защищает от компрометации процесса — апгрейд
  на KMS/Vault в TODO.
- **Миграция `migration-encrypt-tokens.js`** (в корне, идемпотентна) —
  прогнать РАЗ сразу после деплоя. Два режима: без флага печатает готовый SQL
  в stdout (`node migration-encrypt-tokens.js > out.sql` → вставить в Supabase
  SQL Editor); с `--apply` пишет напрямую через supabase-js. Чистого `.sql`-файла
  быть не может — шифротекст делается ключом приложения. До прогона старые
  plaintext-токены отдаются как `null`.
- **env.js падает на старте**, если нет любой из: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `VERIFY_TOKEN`, `IG_APP_SECRET`, `FRONTEND_URL`,
  `TOKEN_ENC_KEY` (+ проверка, что `TOKEN_ENC_KEY` декодится ровно в 32 байта).
  Раньше был мягкий `console.warn`. Отдельного JWT-секрета нет — JWKS публичный.
- **CORS** — `cors({ origin: env.frontendUrl })`, `FRONTEND_URL` обязателен.
- **Express-hardening** (`server.js`): `helmet()` (HSTS, nosniff, frameguard,
  COOP/CORP, no-referrer), `app.disable('x-powered-by')`, явный
  `express.json({ limit: '100kb' })`, единый error-handler в конце — наружу
  не отдаёт стек (5xx → `{ code: "internal_error" }`, 4xx от body-parser →
  `{ code: "bad_request", message }`).
- **Логи**: не пишем `err.response?.data` из ошибок Graph API (могут содержать
  PII/данные) — только `err.message` (везде в `instagram.service.js`).
- **Тесты**: middleware + шифрование покрыты временными скриптами (`jose` +
  локальный JWKS + заглушки репозиториев: 23 кейса auth/ownership/webhook;
  `jose` GCM round-trip/tamper + choke-point репозитория: 20 кейсов).
  Постоянного раннера нет — при доработке гоняй вручную так же.

## Supabase-специфичное

- **"Automatically expose new tables" выключен** — при создании НОВЫХ таблиц
  всегда явно выдавай права: `grant all on public.<table> to service_role;`
  Забытый grant = тихая ошибка "permission denied", код не крашится, просто
  возвращает null/пустой массив.
- **`profiles` не создаётся автоматически** при регистрации через Supabase
  Auth — есть SQL-триггер `handle_new_user()` на `auth.users`, который это
  делает. Если он не запускался — foreign key ошибки при вставке в
  `ig_accounts`.

## Важное соглашение: camelCase vs snake_case на границе API

- **Тело запроса** (то, что фронтенд шлёт в `POST`/`PATCH`) — `camelCase`
  (`postId`, `dmText`, `isActive`), роуты сами мапят в `snake_case` при
  обращении к БД.
- **Тело ответа** (то, что бэкенд возвращает) — `snake_case`
  (`post_id`, `dm_text`, `is_active`), потому что это НЕ преобразованные
  сырые данные из Supabase (колонки БД называются так). Мы их не
  переименовываем перед отправкой на фронт.
- Это несимметрично и может путать — при добавлении новых полей ВСЕГДА
  явно проверяй, в каком формате они придут в ответе, не полагайся на
  единообразие с телом запроса.

## Что НЕ делать

- не хардкодь `IG_BUSINESS_ID`/`PAGE_ACCESS_TOKEN` в код — всё живёт в БД
- не используй `graph.facebook.com` ни для чего в этом проекте
- self-serve OAuth живёт на ФРОНТЕНДЕ через Auth.js, не здесь — этот backend
  только принимает уже готовый long-lived токен на `/api/complete-instagram-connect`

## TODO: безопасность (отложено, не в текущем PR)

Приоритет сверху вниз. Первый пункт — следующая задача.

- **Рефреш Instagram-токена + reconnect UX.** Long-lived IG-токен живёт
  60 дней, продлевается через
  `GET /refresh_access_token?grant_type=ig_refresh_token&access_token=<текущий>`
  (токен должен быть старше 24ч и не истёкшим). **Дизайн (согласован):**
  - *Ленивый рефреш на чтении, без крона.* При любой загрузке токена аккаунта
    (отправка из вебхука, TTL-рефреш аватара, `/media`) смотрим
    `token_expires_at`; если до истечения < 10 дней — дёргаем refresh,
    сохраняем новый токен через `tokenCipher.encrypt` и новый `token_expires_at`.
    Тот же паттерн, что TTL-рефреш аватарки. Неактивный аккаунт (60 дней
    никто не трогал) всё равно умрёт — терпимо, юзер переподключит.
  - *Reconnect уже работает*: повторный `POST /api/complete-instagram-connect`
    с тем же `ig_business_id` → `upsert` по `onConflict` обновляет строку,
    шаблоны сохраняются (`_isTransfer=false`), `subscribeToWebhooks`
    идемпотентен. Отдельной ручки не надо.
  - *Признак для фронта*: в ответ `GET /api/ig-accounts` добавить
    `token_expires_at` + `needs_reconnect: boolean` (near-expiry ИЛИ последний
    вызов упал с ошибкой авторизации). Для «отзыв до истечения» может
    понадобиться колонка `token_invalid_at`.
  - Промпт для фронта на reconnect UX уже составлен (раздел 2 в задаче фронта).
- **Rate limiting** — `express-rate-limit` на `POST /api/complete-instagram-connect`
  и CRUD шаблонов; для `POST /webhook` аккуратно (лимит по IP не подойдёт —
  это настоящая Meta; скорее на уровне Render/прокси). Подтверждено отдельной
  задачей.
- **Валидация входных данных** — сейчас `:id` и тела идут в Supabase как есть;
  кривой UUID → 500 (теперь ловится общим error-handler, но лучше явный 400).
  Нужна схема-валидация (zod/joi) на телах и параметрах.
- **`npm audit`** — ни разу не гоняли; повесить в CI.
- **RLS в Postgres как второй слой** — политики на все таблицы + клиент с
  anon-ключом и JWT юзера. Пути вебхука остаются на service-role. Defense in
  depth поверх проверок в `middleware/ownership.js`.
- **Апгрейд шифрования токенов на KMS/Vault** — сейчас `TOKEN_ENC_KEY` в env
  Render рядом с `SUPABASE_SERVICE_ROLE_KEY` (утечка env вскрывает оба).
  Эскалация: корневой ключ в KMS (envelope encryption) либо Supabase Vault.
  Формат `v1:` готов под смену схемы.
