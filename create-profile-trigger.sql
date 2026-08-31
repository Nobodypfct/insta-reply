-- автоматически создаёт запись в public.profiles при регистрации нового юзера
-- через Supabase Auth, чтобы не приходилось делать это вручную каждый раз

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- на всякий случай: создаём profiles для уже существующих юзеров,
-- у которых её ещё нет (например, для того, кем ты уже тестировал)
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
