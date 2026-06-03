import { requireDatabase, sendJson, supabase } from "../../_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!requireDatabase(res)) return;

  try {
    const { id } = req.query;
    if (!id) return sendJson(res, 400, { error: "Chat id is required." });

    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("chat_id", id);

    if (deleteError) throw deleteError;

    const { error: updateError } = await supabase
      .from("chats")
      .update({ title: "New chat", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) throw updateError;

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}
