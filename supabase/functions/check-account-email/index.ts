import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:5173";
const cors = (request: Request) => ({
  "Access-Control-Allow-Origin": [appUrl, "http://localhost:5173", "http://localhost:8080"].includes(request.headers.get("origin") ?? "") ? request.headers.get("origin")! : appUrl,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors(request) });
  try {
    const { email } = await request.json();
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Enter a valid email address.");
    const { data, error } = await admin.from("profiles").select("id").eq("email", normalized).maybeSingle();
    if (error) throw error;
    return Response.json({ exists: Boolean(data) }, { headers: { ...cors(request), "Content-Type": "application/json" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not check the email address." }, { status: 400, headers: { ...cors(request), "Content-Type": "application/json" } });
  }
});
