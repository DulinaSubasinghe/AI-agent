import {
  groq, supabase, systemInstruction,
  sendJson, readBody,
  getChatWithMessages, insertMessage, updateChatTitle,
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    const body = await readBody(req);
    const { chatId, content, messages } = JSON.parse(body || "{}");

    // Persistent mode — uses Supabase
    if (chatId && content) {
      const chat = await getChatWithMessages(chatId);
      if (!chat) return sendJson(res, 404, { error: "Chat not found." });

      const userContent = String(content).slice(0, 12_000);
      await insertMessage(chatId, "user", userContent);

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemInstruction },
          ...chat.messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userContent },
        ],
      });

      const reply = completion.choices[0]?.message?.content ?? "";
      await insertMessage(chatId, "assistant", reply);
      await updateChatTitle(chatId, userContent);
      return sendJson(res, 200, { message: reply });
    }

    // Stateless mode — no Supabase needed
    if (!Array.isArray(messages)) {
      return sendJson(res, 400, { error: "Messages must be an array." });
    }

    const cleanMessages = messages
      .filter((m) => m && typeof m.content === "string")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content.slice(0, 12_000),
      }));

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: systemInstruction }, ...cleanMessages],
    });

    return sendJson(res, 200, {
      message: completion.choices[0]?.message?.content ?? "",
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}
