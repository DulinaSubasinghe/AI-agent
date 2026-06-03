import { supabase, sendJson, getDefaultProfile } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    const profile = await getDefaultProfile();

    const { data, error } = await supabase
      .from("chats")
      .insert({ profile_id: profile.id })
      .select("id, title, created_at, updated_at")
      .single();

    if (error) throw error;
    return sendJson(res, 200, { chat: { ...data, messages: [] } });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}
