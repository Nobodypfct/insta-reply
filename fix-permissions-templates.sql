-- выдаём service_role права на новые таблицы templates/template_replies,
-- которые не попали в изначальный fix-permissions.sql

grant all on public.templates to service_role;
grant all on public.template_replies to service_role;
