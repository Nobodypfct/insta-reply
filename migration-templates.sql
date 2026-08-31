-- новая модель шаблонов: правила с областью действия (все посты / конкретный пост)
-- и опциональным кодовым словом-триггером

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid references public.ig_accounts(id) on delete cascade not null,
  post_id text,          -- null = применяется ко всем постам; иначе id конкретного поста
  keyword text,          -- null = срабатывает на любой коммент; иначе только если текст содержит это слово
  dm_text text not null default 'Привет! Спасибо за комментарий 🙌 Вот то, что ты искал(а): [ССЫЛКА]',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- варианты ответа на комментарий для конкретного шаблона (рандомный выбор одного при срабатывании)
create table public.template_replies (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.templates(id) on delete cascade not null,
  text text not null
);

create index idx_templates_ig_account_id on public.templates(ig_account_id);
create index idx_templates_post_id on public.templates(post_id);
create index idx_template_replies_template_id on public.template_replies(template_id);

-- старые таблицы reply_templates/dm_settings заменяются новой моделью -
-- переносить исторические данные не нужно, это ранняя dev-стадия проекта
drop table if exists public.reply_templates;
drop table if exists public.dm_settings;
