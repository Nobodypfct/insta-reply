-- Проверка подписки через кнопки в DM.
-- Запусти в Supabase → SQL Editor → New query → Run.

-- состояние диалога "проверка подписки" с конкретным комментатором.
-- одна активная запись на пару (аккаунт, комментатор) - при повторном
-- срабатывании шаблона запись переиспользуется (upsert), не плодим дубли.
create table public.conversation_states (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid references public.ig_accounts(id) on delete cascade not null,
  commenter_id text not null,          -- instagram-scoped id комментатора (IGSID)
  template_id uuid references public.templates(id) on delete cascade not null,
  status text not null default 'awaiting_initial_click',
    -- awaiting_initial_click | awaiting_follow_confirmation | completed
  follow_confirm_attempts int not null default 0, -- сколько раз переспросили про подписку (защита от цикла)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (ig_account_id, commenter_id)
);

create index idx_conversation_states_lookup
  on public.conversation_states(ig_account_id, commenter_id);

-- "Automatically expose new tables" выключен - для НОВОЙ таблицы grant обязателен,
-- иначе тихая "permission denied" (код не падает, просто возвращает null)
grant all on public.conversation_states to service_role;

-- новые поля шаблона под сценарий "проверка подписки".
-- добавление колонок в существующую таблицу templates прав не требует.
alter table public.templates add column if not exists require_follow_check boolean default false;
alter table public.templates add column if not exists button_text_initial text default 'Получить';
alter table public.templates add column if not exists message_if_not_following text;
alter table public.templates add column if not exists button_text_follow_confirm text default 'Я подписался';
alter table public.templates add column if not exists message_after_follow text;
