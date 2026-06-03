import { requireDatabase, sendJson, supabase } from "../../_shared.js";

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!requireDatabase(res)) return;

  try {
    const { id } = req.query;
    if (!id) return sendJson(res, 400, { error: "Chat id is required." });

    const { error } = await supabase.from("chats").delete().eq("id", id);
    if (error) throw error;

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}
