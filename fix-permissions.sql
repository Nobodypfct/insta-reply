-- явно даём service_role полные права на все наши таблицы
-- (иногда после отключения "Automatically expose new tables" права не выдаются автоматически)

grant usage on schema public to service_role;

grant all on public.profiles to service_role;
grant all on public.ig_accounts to service_role;
grant all on public.reply_templates to service_role;
grant all on public.dm_settings to service_role;
grant all on public.activity_log to service_role;
grant all on public.affiliate_links to service_role;
grant all on public.affiliate_referrals to service_role;

-- на случай если используются sequences (для auto-increment, у нас везде uuid, но на всякий случай)
grant usage, select on all sequences in schema public to service_role;
