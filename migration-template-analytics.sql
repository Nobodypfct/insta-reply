-- Аналитика для comment-шаблонов + название шаблона.
-- Запусти в Supabase → SQL Editor → New query → Run.

-- название шаблона для удобства в кабинете (список из многих шаблонов
-- сложно различать по keyword/тексту) - чистый CRUD, никакой логики
alter table public.templates add column if not exists name text;

-- time-series событий воронки шаблона: started (шаблон сработал на
-- коммент) -> link_sent (кнопка-ссылка ушла в сообщении) -> link_clicked
-- (реальный клик через редирект-сервис, см. routes/redirect.routes.js).
-- Событие уже с датой - фильтр по периоду добавится отдельной задачей
-- без новой миграции, агрегат сейчас всегда "за всё время".
create table public.template_events (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.templates(id) on delete cascade not null,
  event_type text not null, -- 'started' | 'link_sent' | 'link_clicked'
  created_at timestamptz default now()
);

create index idx_template_events_template_id on public.template_events(template_id);
create index idx_template_events_type on public.template_events(template_id, event_type);

-- "Automatically expose new tables" выключен - для НОВОЙ таблицы grant обязателен
grant all on public.template_events to service_role;
