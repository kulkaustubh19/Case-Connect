import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const clientId = Deno.env.get("GOOGLE_SCHEDULER_CLIENT_ID")!;
const clientSecret = Deno.env.get("GOOGLE_SCHEDULER_CLIENT_SECRET")!;
const admin = createClient(supabaseUrl, serviceRoleKey);
const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:8080";
const cors = (request: Request) => {
  const origin = request.headers.get("origin") ?? appUrl;
  const allowed = [appUrl, "http://localhost:5173", "http://localhost:8080"];
  return { "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : appUrl, "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
};
const message = "Hi All,\n\nPlease join this meeting for solving the cases.\n\nThanks,\nCaseConnect Team";

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("Sign in is required.");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) throw new Error("Your sign-in session has expired.");
    const { attendeeEmails, startAt, endAt } = await request.json();
    const attendees = [...new Set((attendeeEmails ?? []).map((email: string) => email.trim().toLowerCase()))].filter(Boolean);
    if (!Array.isArray(attendeeEmails) || !attendees.length || attendees.length > 3) throw new Error("A booking must include the host and up to two peers.");
    if (!startAt || !endAt || new Date(startAt) >= new Date(endAt) || new Date(startAt) <= new Date()) throw new Error("Choose a valid future time slot.");
    const { data: connection } = await admin.from("google_calendar_connections").select("scheduler_email,refresh_token").eq("id", "central").maybeSingle();
    if (!connection) throw new Error("The Case Connect scheduler calendar has not been connected yet.");
    const refresh = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: connection.refresh_token, grant_type: "refresh_token" }) });
    const refreshed = await refresh.json();
    if (!refresh.ok || !refreshed.access_token) throw new Error("The scheduler Google connection has expired and must be reconnected by an administrator.");
    const calendarResponse = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshed.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Case Connect · Peer Practice", description: message, start: { dateTime: startAt }, end: { dateTime: endAt }, attendees: attendees.map((email: string) => ({ email })), conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
    });
    const event = await calendarResponse.json();
    if (!calendarResponse.ok) throw new Error(event.error?.message ?? "Google Calendar could not create the event.");
    const meetUrl = event.hangoutLink ?? event.conferenceData?.entryPoints?.find((entry: { entryPointType: string }) => entry.entryPointType === "video")?.uri;
    if (!meetUrl) throw new Error("The Google Calendar event was created, but Meet is still being generated. Please try again in a moment.");
    return Response.json({ eventId: event.id, meetUrl, schedulerEmail: connection.scheduler_email }, { headers: { ...cors(request), "Content-Type": "application/json" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create the meeting." }, { status: 400, headers: { ...cors(request), "Content-Type": "application/json" } });
  }
});
