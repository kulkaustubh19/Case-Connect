import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceRoleKey);
const allowedOrigins = [Deno.env.get("APP_URL") ?? "http://localhost:5173", "http://localhost:5173", "http://localhost:8080"];
const cors = (request: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigins.includes(request.headers.get("origin") ?? "") ? request.headers.get("origin")! : allowedOrigins[0],
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
});

async function requireAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Sign in is required.");
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Your sign-in session has expired.");
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "Admin") throw new Error("Only administrators can manage users.");
  return user;
}

serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  try {
    const currentUser = await requireAdmin(request);
    if (request.method === "GET") {
      const { data, error } = await admin.from("profiles").select("id,email,full_name,role,work_experience,industry").order("created_at", { ascending: false });
      if (error) throw error;
      return Response.json(data, { headers: cors(request) });
    }
    const body = await request.json();
    if (!body.userId) throw new Error("A userId is required.");
    if (body.userId === currentUser.id) throw new Error("You cannot change or delete your own administrator account here.");
    if (request.method === "PATCH") {
      if (!["User", "Admin"].includes(body.role)) throw new Error("Choose a valid role.");
      const { error } = await admin.from("profiles").update({ role: body.role }).eq("id", body.userId);
      if (error) throw error;
      return Response.json({ ok: true }, { headers: cors(request) });
    }
    if (request.method === "DELETE") {
      const { error } = await admin.auth.admin.deleteUser(body.userId);
      if (error) throw error;
      return Response.json({ ok: true }, { headers: cors(request) });
    }
    return new Response("Method not allowed", { status: 405, headers: cors(request) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400, headers: { ...cors(request), "Content-Type": "application/json" } });
  }
});
