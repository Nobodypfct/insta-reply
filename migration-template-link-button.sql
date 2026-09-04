-- Кнопка-ссылка под финальным сообщением шаблона (шаг "После подписки").
-- Запусти в Supabase → SQL Editor → New query → Run.
--
-- Это ОБЫЧНАЯ кнопка со ссылкой (открывает URL), НЕ postback-кнопка типа
-- button_text_initial / button_text_follow_confirm. Никакой логики вокруг
-- неё нет - чистые CRUD-поля. Пустая строка "" = кнопки нет.
-- Добавление колонок в существующую таблицу templates прав не требует.

alter table public.templates add column if not exists link_button_text text;
alter table public.templates add column if not exists link_button_url text;
