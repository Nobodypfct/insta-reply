-- Аватар подключённого Instagram-аккаунта (для дашборда).
-- Запусти в Supabase → SQL Editor → New query → Run.
--
-- Добавление колонки в существующую таблицу ig_accounts прав не требует
-- (grant нужен только для НОВЫХ таблиц). Nullable: Instagram не всегда
-- отдаёт profile_picture_url.

alter table public.ig_accounts add column if not exists avatar_url text;
