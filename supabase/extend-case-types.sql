-- Run once in Supabase SQL Editor before adding Product Management or Marketing cases.
alter table public.case_catalogue
  drop constraint if exists case_catalogue_case_type_check;

alter table public.case_catalogue
  add constraint case_catalogue_case_type_check
  check (case_type in (
    'Profitability', 'Market Entry', 'Pricing', 'M&A and Due Diligence', 'Unconventional',
    'Guesstimates', 'Product Design', 'App Improvement', 'RCA', 'Campaign Planning'
  ));
