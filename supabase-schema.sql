-- Insta-Reply: схема базы данных
-- Запусти этот скрипт в Supabase → SQL Editor → New query → Run

-- владелец кабинета (использует встроенную auth.users от Supabase Auth,
-- эта таблица хранит доп. поля, которых нет в auth.users)
create table public.profiles (
  id uuid references auth.users(id) primary key,
  email text not null,
  subscription_status text default 'trial', -- trial / active / cancelled
  subscription_plan text default 'start',   -- start / pro / agency
  created_at timestamptz default now()
);

-- подключённые Instagram-аккаунты (много на одного пользователя)
create table public.ig_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  ig_business_id text not null unique,
  username text not null,
  page_access_token text not null, -- в проде стоит шифровать перед сохранением
  token_expires_at timestamptz,
  webhook_enabled boolean default true,
  created_at timestamptz default now()
);

-- шаблоны ответа на комментарий (несколько штук на один ig_account, рандомный выбор)
create table public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid references public.ig_accounts(id) not null,
  text text not null,
  created_at timestamptz default now()
);

-- текст DM-сообщения (один активный на ig_account)
create table public.dm_settings (
  ig_account_id uuid references public.ig_accounts(id) primary key,
  dm_text text not null default 'Спасибо за комментарий! Вот что вы искали: [ССЫЛКА]',
  updated_at timestamptz default now()
);

-- лог обработанных комментариев (для статистики и будущей аналитики)
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid references public.ig_accounts(id) not null,
  comment_id text not null,
  commenter_id text not null,
  commenter_username text,
  comment_text text,
  post_id text,
  replied_at timestamptz,
  dm_sent_at timestamptz,
  dm_success boolean default false,
  created_at timestamptz default now()
);

-- партнёрские ссылки (у пользователя, который стал партнёром)
create table public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null unique,
  code text not null unique, -- короткий промокод/реф-код
  created_at timestamptz default now()
);

-- рефералы: кто кого привёл и сколько начислено
create table public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid references public.profiles(id) not null, -- кто привёл
  referred_user_id uuid references public.profiles(id) not null,  -- кого привели
  commission_rate numeric default 0.5, -- 0.5 = 50%
  total_earned numeric default 0,      -- сколько начислено всего
  created_at timestamptz default now()
);

-- индексы для ускорения частых запросов
create index idx_ig_accounts_user_id on public.ig_accounts(user_id);
create index idx_activity_log_ig_account_id on public.activity_log(ig_account_id);
create index idx_activity_log_created_at on public.activity_log(created_at);
create index idx_affiliate_referrals_affiliate on public.affiliate_referrals(affiliate_user_id);
