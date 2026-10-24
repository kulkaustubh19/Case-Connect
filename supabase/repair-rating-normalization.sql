-- Run this once in Supabase SQL Editor.
-- It replaces the old full-table rating refresh which issued an unfiltered
-- DELETE. Each rating now refreshes only its own case summary.
create or replace function public.refresh_case_rating_summary(p_case_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.case_rating_summaries (case_id, normalized_score, rating_count, raw_average, updated_at)
  with global_stats as (
    select coalesce(avg(rating)::numeric, 0::numeric) as mean_rating from public.case_ratings
  ), user_stats as (
    select user_id, avg(rating)::numeric as user_mean, count(*)::numeric as rating_total
    from public.case_ratings group by user_id
  ), adjusted as (
    select r.case_id, r.rating::numeric,
      greatest(1::numeric, least(5::numeric,
        r.rating::numeric - (((u.user_mean * u.rating_total + g.mean_rating * 10) / (u.rating_total + 10)) - g.mean_rating)
      )) as normalized_rating
    from public.case_ratings r
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
  from per_case p cross join global_stats g
  on conflict (case_id) do update set
    normalized_score = excluded.normalized_score,
    rating_count = excluded.rating_count,
    raw_average = excluded.raw_average,
    updated_at = excluded.updated_at;
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
