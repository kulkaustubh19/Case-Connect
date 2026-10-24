-- Optional: run this once to make the six built-in demonstration cards real
-- Supabase catalogue records. Do not run it if you already use IDs 1–6 for
-- different cases.
alter table public.case_catalogue
  add column if not exists domain text not null default 'Consulting'
  check (domain in ('Consulting', 'Product Management', 'Marketing'));

insert into public.case_catalogue (id, title, case_type, difficulty, company, industry, description, domain)
overriding system value values
  (1, 'UrbanKart Profitability Turnaround', 'Profitability', 'Intermediate', 'Bain & Company', 'E-commerce', 'An online retailer needs to restore margins while keeping customer growth on track.', 'Consulting'),
  (2, 'VoltRide Market Entry', 'Market Entry', 'Beginner', 'McKinsey & Company', 'Mobility', 'A premium electric two-wheeler company is considering its India launch strategy.', 'Consulting'),
  (3, 'CloudDesk Pricing Strategy', 'Pricing', 'Intermediate', 'BCG', 'SaaS', 'A B2B SaaS company must redesign its pricing model for enterprise growth.', 'Product Management'),
  (4, 'Medico Acquisition Decision', 'M&A and Due Diligence', 'Advanced', 'Deloitte', 'Healthcare', 'Evaluate a target acquisition and identify the critical diligence questions.', 'Consulting'),
  (5, 'The Airport Queue Challenge', 'Unconventional', 'Advanced', 'Kearney', 'Travel', 'Solve an operational challenge with incomplete data and competing stakeholders.', 'Marketing'),
  (6, 'Fresco Foods Profitability', 'Profitability', 'Beginner', 'Bain & Company', 'Consumer Goods', 'A regional food company is facing margin pressure across its portfolio.', 'Consulting')
on conflict (id) do nothing;

select setval(
  pg_get_serial_sequence('public.case_catalogue', 'id'),
  greatest((select coalesce(max(id), 1) from public.case_catalogue), 1),
  true
);
