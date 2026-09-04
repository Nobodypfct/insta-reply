-- Второй тип шаблона — "Ответ в директ" (триггер: входящее DM-сообщение,
-- а не комментарий). Запусти в Supabase → SQL Editor → New query → Run.

-- 'comment' (существующее поведение, дефолт для всех старых строк) | 'dm'.
-- без db-level check constraint - по конвенции проекта (см. conversation_states.status,
-- там тоже text с перечислением значений в комментарии, а не enum/check)
alter table public.templates add column if not exists type text not null default 'comment';

-- ссылки для DM-шаблонов: [{ text, url }, ...]. Заполняется только для type='dm'.
-- пока чистый CRUD без логики отправки - как в своё время link_button_text/url
alter table public.templates add column if not exists links jsonb;

-- режим сравнения текста DM с keyword: false (по умолчанию) = contains,
-- как у comment-шаблонов; true = точное совпадение (после trim+lowercase).
-- применяется только к type='dm' - comment-шаблоны не трогали, они как были
-- contains-only, так и остались
alter table public.templates add column if not exists exact_match boolean not null default false;

create index if not exists idx_templates_type on public.templates(type);
