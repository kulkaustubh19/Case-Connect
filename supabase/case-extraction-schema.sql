-- Run once in the Supabase SQL editor before deploying process-case-images.
-- case_media is included because the uploader needs it to link private images
-- to a catalogue case. The extraction stores the one-time Tesseract result;
-- signed-in members can read the result while Edge Functions write it.

create table if not exists public.case_media (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.case_catalogue(id) on delete cascade,
  media_type text not null check (media_type in ('conversation', 'solution')),
  storage_path text not null,
  position integer not null default 0
);

alter table public.case_media enable row level security;
drop policy if exists "media readable" on public.case_media;
create policy "media readable" on public.case_media for select to authenticated using (true);

create table if not exists public.case_extractions (
  case_id bigint primary key references public.case_catalogue(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  conversation jsonb not null default '[]'::jsonb,
  solution jsonb not null default '{"case_facts":[],"recommendations":[],"tips_and_tricks":[],"flowchart_summary":""}'::jsonb,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.case_extractions enable row level security;

drop policy if exists "case extractions readable" on public.case_extractions;
create policy "case extractions readable"
  on public.case_extractions for select to authenticated using (true);

-- An update timestamp makes processing history clear in the dashboard.
create or replace function public.touch_case_extraction_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_case_extractions_updated_at on public.case_extractions;
create trigger touch_case_extractions_updated_at
before update on public.case_extractions
for each row execute procedure public.touch_case_extraction_updated_at();
