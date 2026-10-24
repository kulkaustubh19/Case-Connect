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
  if (data?.role !== "Admin") throw new Error("Only administrators can manage cases.");
}

async function ensureBucket() {
  const existing = await admin.storage.getBucket("case-materials");
  if (!existing.data) await admin.storage.createBucket("case-materials", { public: false });
  else if (existing.data.public) await admin.storage.updateBucket("case-materials", { public: false });
}

async function catalogueWithSignedImages() {
  const [{ data: catalogue, error: catalogueError }, { data: media, error: mediaError }, { data: extractions, error: extractionsError }] = await Promise.all([
    admin.from("case_catalogue").select("*").order("id"),
    admin.from("case_media").select("case_id,media_type,storage_path,position").order("position"),
    admin.from("case_extractions").select("case_id,status,conversation,solution,processed_at"),
  ]);
  if (catalogueError || mediaError || extractionsError) throw new Error(catalogueError?.message ?? mediaError?.message ?? extractionsError?.message ?? "Could not load cases.");
  const mediaByCase = new Map<number, { conversationImages: string[]; solutionImages: string[] }>();
  for (const item of media ?? []) {
    const { data: signed } = await admin.storage.from("case-materials").createSignedUrl(item.storage_path, 60 * 60);
    if (!signed?.signedUrl) continue;
    const entry = mediaByCase.get(item.case_id) ?? { conversationImages: [], solutionImages: [] };
    (item.media_type === "conversation" ? entry.conversationImages : entry.solutionImages).push(signed.signedUrl);
    mediaByCase.set(item.case_id, entry);
  }
  const extractionByCase = new Map((extractions ?? []).map((item) => [item.case_id, item]));
  return (catalogue ?? []).map((item) => ({
    id: item.id, title: item.title, type: item.case_type, difficulty: item.difficulty,
    company: item.company, industry: item.industry, description: item.description, domain: item.domain,
    ...(mediaByCase.get(item.id) ?? { conversationImages: [], solutionImages: [] }),
  }));
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  let phase = "authorizing";
  let caseId: number | null = null;
  try {
    console.log("case-catalogue request", { method: request.method });
    const user = await signedInUser(request);
    console.log("case-catalogue authenticated", { userId: user.id, method: request.method });
    if (request.method === "GET") return Response.json(await catalogueWithSignedImages(), { headers: cors(request) });

    phase = "checking-admin-role";
    await requireAdmin(user.id);
    if (request.method === "DELETE") {
      const { caseId } = await request.json();
      const { error } = await admin.from("case_catalogue").delete().eq("id", caseId);
      if (error) throw error;
      return Response.json({ ok: true }, { headers: cors(request) });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors(request) });

    phase = "reading-upload-form";
    const form = await request.formData();
    const metadata = JSON.parse(String(form.get("metadata") ?? "{}"));
    for (const key of ["title", "type", "difficulty", "company", "industry", "description", "domain"]) if (!metadata[key]) throw new Error(`Missing ${key}.`);
    console.log("case-catalogue upload received", { conversationImages: form.getAll("conversation").length, solutionImages: form.getAll("solution").length });
    phase = "creating-catalogue-record";
    const { data: created, error: createError } = await admin.from("case_catalogue").insert({
      title: metadata.title, case_type: metadata.type, difficulty: metadata.difficulty, company: metadata.company,
      industry: metadata.industry, description: metadata.description, domain: metadata.domain,
    }).select().single();
    if (createError || !created) throw createError ?? new Error("Could not create the case.");
    caseId = created.id;
    console.log("case-catalogue record created", { caseId });
    phase = "preparing-private-storage";
    await ensureBucket();
    for (const mediaType of ["conversation", "solution"]) {
      const files = form.getAll(mediaType).filter((item): item is File => item instanceof File);
      for (let position = 0; position < files.length; position++) {
        const file = files[position];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const storagePath = `${created.id}/${mediaType}/${position}-${safeName}`;
        phase = `uploading-${mediaType}-${position + 1}`;
        const { error: uploadError } = await admin.storage.from("case-materials").upload(storagePath, file, { contentType: file.type || "image/png", upsert: false });
        if (uploadError) throw uploadError;
        phase = `linking-${mediaType}-${position + 1}`;
        const { error: mediaError } = await admin.from("case_media").insert({ case_id: created.id, media_type: mediaType, storage_path: storagePath, position });
        if (mediaError) throw mediaError;
      }
    }
    phase = "creating-extraction-record";
    const { error: extractionError } = await admin.from("case_extractions").upsert({ case_id: created.id, status: "pending" }, { onConflict: "case_id" });
    if (extractionError) throw extractionError;
    console.log("case-catalogue upload completed", { caseId });
    return Response.json((await catalogueWithSignedImages()).find((item) => item.id === created.id), { headers: cors(request) });
  } catch (error) {
    const message = describeError(error);
    console.error("case-catalogue failed", { phase, caseId, message });
    if (caseId) {
      const { error: cleanupError } = await admin.from("case_catalogue").delete().eq("id", caseId);
      if (cleanupError) console.error("case-catalogue cleanup failed", { caseId, message: describeError(cleanupError) });
      else console.log("case-catalogue rolled back incomplete case", { caseId });
    }
    return Response.json({ error: `Case upload failed during ${phase}: ${message}` }, { status: 400, headers: { ...cors(request), "Content-Type": "application/json" } });
  }
});
