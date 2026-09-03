-- Аватар подключённого Instagram-аккаунта + метка последнего обновления
-- (для TTL-gated рефреша без крона).
-- Запусти в Supabase → SQL Editor → New query → Run.
--
-- Добавление колонок в существующую таблицу ig_accounts прав не требует
-- (grant нужен только для НОВЫХ таблиц). Обе nullable: Instagram отдаёт
-- profile_picture_url только в момент OAuth-подключения и не всегда.

alter table public.ig_accounts add column if not exists avatar_url text;
alter table public.ig_accounts add column if not exists avatar_url_updated_at timestamptz;
