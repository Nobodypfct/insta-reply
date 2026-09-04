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
  repositories/                    — SQL-запросы, ничего больше
    igAccount.repository.js
    template.repository.js
    conversationState.repository.js — состояние диалога "проверка подписки"
    activityLog.repository.js
  services/                        — бизнес-логика
    instagram.service.js           — все вызовы к Instagram API
    webhook.service.js             — обработка входящего комментария/postback
    oauth.service.js               — завершение OAuth-подключения
    igAccount.service.js           — список аккаунтов + TTL-рефреш аватарки
  routes/                          — тонкий HTTP-слой
    webhook.routes.js
    igAccounts.routes.js
    templates.routes.js
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

## Важные решения архитектуры

- **Мультитенантность**: `entry.id` из вебхука = `ig_business_id` аккаунта-
  владельца поста. По нему ищем нужный `ig_account` в БД, не хардкодим.
- **Модель шаблонов**: `templates` (scope: все посты / конкретный пост +
  опциональное keyword-слово) + `template_replies` (варианты ответа,
  рандомный выбор). Приоритет матчинга: пост-специфичный с keyword →
  пост-специфичный catch-all → все-посты с keyword → все-посты catch-all.
  Логика в `template.repository.js::matchTemplate`, покрыта юнит-тестами
  (гоняй руками через `node -e`, отдельного test runner пока нет).
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
