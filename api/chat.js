import {
  groq,
  requireDatabase,
  readBody,
  sendJson,
  getChatWithMessages,
  insertMessage,
  updateChatTitle,
} from "./_shared.js";

const systemInstruction =
  "You are a helpful AI assistant. Be concise, friendly, and accurate.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!requireDatabase(res)) return;

  try {
    const body = await readBody(req);
    const { chatId, content, messages } = JSON.parse(body || "{}");

    if (chatId && content) {
      const chat = await getChatWithMessages(chatId);
      if (!chat) {
        return sendJson(res, 404, { error: "Chat not found." });
      }

      const userContent = String(content).slice(0, 12000);
      await insertMessage(chatId, "user", userContent);

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemInstruction },
          ...chat.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: "user", content: userContent },
        ],
      });

      const reply = completion.choices[0]?.message?.content ?? "";
      await insertMessage(chatId, "assistant", reply);
      await updateChatTitle(chatId, userContent);

      return sendJson(res, 200, { message: reply });
    }

    if (!Array.isArray(messages)) {
      return sendJson(res, 400, { error: "Messages must be an array." });
    }

    const cleanMessages = messages
      .filter((message) => message && typeof message.content === "string")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content.slice(0, 12000),
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
