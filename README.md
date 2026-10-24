# Case Connect

Interactive Vite/React prototype for case practice, peer scheduling and learner progress.

## Connect Supabase

1. Create a Supabase project and enable Email/Password authentication.
2. Run `supabase/schema.sql` in the SQL editor.
3. Copy `.env.example` to `.env.local` and set the project URL and anonymous key.
4. Sign up as `kulkaustubh19@gmail.com` with the desired password. The database trigger assigns **Kaustubh Kulkarni** the `Admin` role; all other registrations receive `User`.

Supabase Auth stores and hashes credentials. The app table stores profile metadata and roles, never raw passwords. The schema also stores completed cases, peer availability, sessions and invitees. Google Calendar/Meet needs an OAuth flow implemented through a Supabase Edge Function so the Google client secret stays server-side.
