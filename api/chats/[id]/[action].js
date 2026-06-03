import { supabase, sendJson } from "../../_lib.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  const { id, action } = req.query;

  if (action === "clear" && req.method === "POST") {
    try {
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

  if (action === "delete" && req.method === "DELETE") {
    try {
      const { error } = await supabase.from("chats").delete().eq("id", id);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || "Something went wrong." });
    }
  }

  return sendJson(res, 405, { error: "Method not allowed." });
}
