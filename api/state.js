import { supabase, sendJson, getDefaultProfile } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    const profile = await getDefaultProfile();

    const { data: chats, error: chatsError } = await supabase
      .from("chats")
      .select("id, title, created_at, updated_at")
      .eq("profile_id", profile.id)
      .order("updated_at", { ascending: false });

    if (chatsError) throw chatsError;

    const chatIds = (chats ?? []).map((c) => c.id);
    const { data: messages, error: messagesError } = chatIds.length
      ? await supabase
          .from("messages")
          .select("id, chat_id, role, content, created_at")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

    if (messagesError) throw messagesError;

    return sendJson(res, 200, {
      profile,
      chats: (chats ?? []).map((chat) => ({
        ...chat,
        messages: (messages ?? []).filter((m) => m.chat_id === chat.id),
      })),
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}
