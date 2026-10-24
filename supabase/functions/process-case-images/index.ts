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

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [value.message, value.details, value.hint, value.code].filter(Boolean).map(String).join(" — ") || JSON.stringify(error);
  }
  return String(error || "Unknown error");
}

async function signedInUser(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Sign in is required.");
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Your sign-in session has expired.");
  return user;
}

async function requireAdmin(userId: string) {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (data?.role !== "Admin") throw new Error("Only administrators can save case transcripts.");
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  let phase = "authorizing";
  let caseId: number | null = null;
  try {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors(request) });
    const user = await signedInUser(request);
    console.log("process-case-images authenticated", { userId: user.id });
    phase = "checking-admin-role";
    await requireAdmin(user.id);
    phase = "reading-tesseract-transcript";
    const body = await request.json();
    caseId = body.caseId;
    const conversation = Array.isArray(body.conversation) ? body.conversation : null;
    if (!Number.isInteger(caseId)) throw new Error("A valid caseId is required.");
    if (!conversation) throw new Error("A Tesseract conversation transcript is required.");
    if (conversation.some((turn: unknown) => !turn || typeof turn !== "object" || typeof (turn as { text?: unknown }).text !== "string")) {
      throw new Error("The transcript format is invalid.");
    }
    phase = "checking-existing-transcript";
    const { data: existing, error: existingError } = await admin.from("case_extractions").select("*").eq("case_id", caseId).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "completed") return Response.json({ ok: true, reused: true, extraction: existing }, { headers: cors(request) });

    phase = "saving-tesseract-transcript";
    const { data: saved, error: saveError } = await admin.from("case_extractions").upsert({
      case_id: caseId,
      status: "completed",
      conversation,
      solution: { case_facts: [], recommendations: [], tips_and_tricks: [], flowchart_summary: "" },
      error: null,
      processed_at: new Date().toISOString(),
    }, { onConflict: "case_id" }).select().single();
    if (saveError) throw saveError;
    console.log("process-case-images saved Tesseract transcript", { caseId, turns: conversation.length });
    return Response.json({ ok: true, extraction: saved }, { headers: cors(request) });
  } catch (error) {
    const message = describeError(error);
    console.error("process-case-images failed", { phase, caseId, message });
    return Response.json({ ok: false, error: message }, { status: 400, headers: { ...cors(request), "Content-Type": "application/json" } });
  }
});
