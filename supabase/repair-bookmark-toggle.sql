-- Run this once in Supabase SQL Editor to repair bookmark save / removal.
-- It deliberately uses UPDATE (not DELETE) when a case is unsaved.
alter table public.case_bookmarks
  add column if not exists is_saved boolean not null default true;

create or replace function public.toggle_case_bookmark(p_case_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  currently_saved boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to save a case';
  end if;

  select is_saved into currently_saved
  from case_bookmarks
  where user_id = auth.uid() and case_id = p_case_id;

  if found then
    update case_bookmarks
    set is_saved = not currently_saved
    where user_id = auth.uid() and case_id = p_case_id;
    return not currently_saved;
  end if;

  insert into case_bookmarks (user_id, case_id, is_saved)
  values (auth.uid(), p_case_id, true);
  return true;
end;
$$;

grant execute on function public.toggle_case_bookmark(bigint) to authenticated;
