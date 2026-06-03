import { supabase, sendJson, readBody, getDefaultProfile } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    const body = await readBody(req);
    const { username } = JSON.parse(body || "{}");
    const profile = await getDefaultProfile();

    const { data, error } = await supabase
      .from("profiles")
      .update({ username: String(username || "You").slice(0, 24) })
      .eq("id", profile.id)
      .select("id, username, created_at")
      .single();

    if (error) throw error;
    return sendJson(res, 200, { profile: data });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}
