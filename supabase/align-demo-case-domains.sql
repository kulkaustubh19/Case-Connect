-- Optional UAT alignment for the built-in demo catalogue.
-- Run this after extend-case-types.sql if you seeded the original six cases.
update public.case_catalogue
set title = 'CloudDesk Product Design', case_type = 'Product Design'
where id = 3 and domain = 'Product Management';

update public.case_catalogue
set case_type = 'Campaign Planning'
where id = 5 and domain = 'Marketing';
