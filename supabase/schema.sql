-- Case Connect: run this in the Supabase SQL editor after enabling Email auth.
create type public.app_role as enum ('User', 'Admin');
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null unique, full_name text not null, role public.app_role not null default 'User', work_experience text, industry text, created_at timestamptz not null default now());
create table public.case_catalogue (id bigint generated always as identity primary key, title text not null, case_type text not null check (case_type in ('Profitability','Market Entry','Pricing','M&A and Due Diligence','Unconventional','Guesstimates','Product Design','App Improvement','RCA','Campaign Planning')), difficulty text not null check (difficulty in ('Beginner','Intermediate','Advanced')), company text not null, industry text not null, description text not null);
create table public.case_progress (user_id uuid references public.profiles(id) on delete cascade, case_id bigint references public.case_catalogue(id) on delete cascade, completed_at timestamptz not null default now(), primary key (user_id, case_id));
create table public.peer_availability (id bigint generated always as identity primary key, user_id uuid not null references public.profiles(id) on delete cascade, starts_at timestamptz not null, ends_at timestamptz not null, unique(user_id,starts_at));
create table public.peer_sessions (id bigint generated always as identity primary key, organizer_id uuid not null references public.profiles(id), starts_at timestamptz not null, ends_at timestamptz not null, google_meet_url text not null, created_at timestamptz not null default now());
create table public.peer_session_invitees (session_id bigint references public.peer_sessions(id) on delete cascade, profile_id uuid references public.profiles(id) on delete cascade, primary key(session_id,profile_id));
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id,email,full_name,role) values (new.id,new.email,case when lower(new.email)='kulkaustubh19@gmail.com' then 'Kaustubh Kulkarni' else coalesce(new.raw_user_meta_data->>'full_name','') end,case when lower(new.email)='kulkaustubh19@gmail.com' then 'Admin'::public.app_role else 'User'::public.app_role end); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
alter table public.profiles enable row level security; alter table public.case_progress enable row level security; alter table public.peer_availability enable row level security; alter table public.peer_sessions enable row level security; alter table public.peer_session_invitees enable row level security;
create policy "profiles visible to signed in users" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid()=id);
create policy "own progress" on public.case_progress for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "availability visible" on public.peer_availability for select to authenticated using (true);
create policy "own availability" on public.peer_availability for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "sessions visible to members" on public.peer_sessions for select to authenticated using (organizer_id=auth.uid() or exists(select 1 from public.peer_session_invitees i where i.session_id=id and i.profile_id=auth.uid()));
create policy "organizer creates sessions" on public.peer_sessions for insert to authenticated with check (organizer_id=auth.uid());
-- Sign up once as kulkaustubh19@gmail.com with your chosen password: the trigger assigns Admin. All other signups receive User.

-- Case administration, image uploads, and permission management additions.
alter table public.case_catalogue add column if not exists domain text not null default 'Consulting' check (domain in ('Consulting','Product Management','Marketing'));
create table if not exists public.case_media (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.case_catalogue(id) on delete cascade,
  media_type text not null check (media_type in ('conversation','solution')),
  storage_path text not null,
  position integer not null default 0
);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.profiles where id=auth.uid() and role='Admin')
$$;
alter table public.case_catalogue enable row level security;
alter table public.case_media enable row level security;
create policy "catalogue readable" on public.case_catalogue for select to authenticated using (true);
create policy "media readable" on public.case_media for select to authenticated using (true);
create policy "admins manage catalogue" on public.case_catalogue for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage media" on public.case_media for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Create a private Storage bucket named case-materials in the Supabase dashboard.
-- Upload through a server-side Edge Function after checking public.is_admin(); do not allow public writes.
-- Restrict email/password signups to IIMB. Google OAuth remains permitted as requested.
create or replace function public.reject_non_iimb_password_signup() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider','email')='email' and lower(new.email) !~ '@iimb\\.ac\\.in$' then
    raise exception 'Email/password signup requires an @iimb.ac.in email address';
  end if;
  return new;
end; $$;
create trigger reject_non_iimb_password_signup before insert on auth.users for each row execute procedure public.reject_non_iimb_password_signup();

-- Central Google Calendar connection. These tables deliberately have no browser-accessible
-- policies: only a Supabase Edge Function using the service-role key may read refresh tokens.
create table if not exists public.google_calendar_connections (
  id text primary key default 'central' check (id = 'central'),
  scheduler_email text not null,
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_calendar_connections enable row level security;

create table if not exists public.google_calendar_oauth_states (
  state text primary key,
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.google_calendar_oauth_states enable row level security;

-- Persistent user libraries, progress, and community ratings.
create table if not exists public.case_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id bigint not null references public.case_catalogue(id) on delete cascade,
  is_saved boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, case_id)
);

-- Existing installations may have been created before is_saved was added.
alter table public.case_bookmarks
  add column if not exists is_saved boolean not null default true;

create table if not exists public.case_ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id bigint not null references public.case_catalogue(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, case_id)
);

create table if not exists public.case_rating_summaries (
  case_id bigint primary key references public.case_catalogue(id) on delete cascade,
  normalized_score numeric(3,2) not null,
  rating_count integer not null,
  raw_average numeric(3,2) not null,
  updated_at timestamptz not null default now()
);

alter table public.case_bookmarks enable row level security;
alter table public.case_ratings enable row level security;
alter table public.case_rating_summaries enable row level security;

create policy "users manage own bookmarks" on public.case_bookmarks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own ratings" on public.case_ratings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rating summaries visible" on public.case_rating_summaries for select to authenticated using (true);

-- A scoped server-side toggle. Un-saving is a flag update rather than a row
-- deletion, so it does not depend on DELETE policies or triggers.
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

drop policy if exists "shared completion summaries" on public.case_progress;
create policy "shared completion summaries" on public.case_progress for select to authenticated using (true);

-- Ratings are normalized for each rater's usual generosity/strictness, then
-- Bayesian-weighted toward the community mean when a case has few ratings.
create or replace function public.refresh_case_rating_summary(p_case_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into case_rating_summaries (case_id, normalized_score, rating_count, raw_average, updated_at)
  with global_stats as (
    select coalesce(avg(rating)::numeric, 0::numeric) as mean_rating from case_ratings
  ), user_stats as (
    select user_id, avg(rating)::numeric as user_mean, count(*)::numeric as rating_total
    from case_ratings group by user_id
  ), adjusted as (
    select r.case_id, r.rating::numeric,
      greatest(1::numeric, least(5::numeric,
        r.rating::numeric - (((u.user_mean * u.rating_total + g.mean_rating * 10) / (u.rating_total + 10)) - g.mean_rating)
      )) as normalized_rating
    from case_ratings r
    join user_stats u on u.user_id = r.user_id
    cross join global_stats g
    where r.case_id = p_case_id
  ), per_case as (
    select case_id, count(*)::integer as rating_count, avg(rating)::numeric as raw_average,
      avg(normalized_rating)::numeric as normalized_average
    from adjusted group by case_id
  )
  select p.case_id,
    round(((p.rating_count::numeric / (p.rating_count + 5)) * p.normalized_average + (5::numeric / (p.rating_count + 5)) * g.mean_rating), 2),
    p.rating_count, round(p.raw_average, 2), now()
  from per_case p cross join global_stats g;
end;
$$;

create or replace function public.on_case_rating_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_case_rating_summary(coalesce(new.case_id, old.case_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_case_rating_summaries_on_change on public.case_ratings;
create trigger refresh_case_rating_summaries_on_change
after insert or update or delete on public.case_ratings
for each row execute procedure public.on_case_rating_change();
