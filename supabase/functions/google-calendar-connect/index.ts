import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const clientId = Deno.env.get("GOOGLE_SCHEDULER_CLIENT_ID")!;
const clientSecret = Deno.env.get("GOOGLE_SCHEDULER_CLIENT_SECRET")!;
const redirectUri = Deno.env.get("GOOGLE_SCHEDULER_REDIRECT_URI")!;
const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:8080";
const admin = createClient(supabaseUrl, serviceRoleKey);
const cors = (request: Request) => {
  const origin = request.headers.get("origin") ?? appUrl;
  const allowed = [appUrl, "http://localhost:5173", "http://localhost:8080"];
  return { "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : appUrl, "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
};

async function requireAdmin(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Sign in is required.");
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Your sign-in session has expired.");
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "Admin") throw new Error("Only an administrator can connect the scheduler calendar.");
  return user;
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  try {
    // Step 1: an authenticated administrator starts the Google authorization flow.
    if (request.method === "POST") {
      if (!clientId || !clientSecret || !redirectUri) throw new Error("Scheduler OAuth is incomplete. Set GOOGLE_SCHEDULER_CLIENT_ID, GOOGLE_SCHEDULER_CLIENT_SECRET, and GOOGLE_SCHEDULER_REDIRECT_URI in Edge Function secrets.");
      const user = await requireAdmin(request);
      const newState = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error } = await admin.from("google_calendar_oauth_states").insert({ state: newState, created_by: user.id, expires_at: expiresAt });
      if (error) throw error;
      const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizeUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email",
        state: newState,
      }).toString();
      return Response.json({ authorizeUrl }, { headers: cors(request) });
    }

    // Step 2: Google returns here with a short-lived authorization code.
    if (request.method !== "GET" || !code || !state) return new Response("Use the Case Connect admin calendar connection action.", { status: 400 });
    const { data: savedState } = await admin.from("google_calendar_oauth_states").select("state,expires_at").eq("state", state).maybeSingle();
    await admin.from("google_calendar_oauth_states").delete().eq("state", state);
    if (!savedState || new Date(savedState.expires_at) < new Date()) throw new Error("This calendar connection link has expired. Start again from Case Connect.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove Case Connect from your Google Account permissions, then connect again.");
    const emailResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const account = await emailResponse.json();
    if (!emailResponse.ok || !account.email) throw new Error("Could not confirm the scheduler Google account.");
    const { error } = await admin.from("google_calendar_connections").upsert({ id: "central", scheduler_email: account.email, refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() });
    if (error) throw error;
    return Response.redirect(`${appUrl}/?google_calendar_connected=1`, 302);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not connect Google Calendar." }, { status: 400, headers: cors(request) });
  }
});
