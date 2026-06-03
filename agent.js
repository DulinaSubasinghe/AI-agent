import dotenv from "dotenv";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync } from "fs";
import { extname, join } from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

dotenv.config({ path: join(__dirname, "key.env"), quiet: true });

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error("Error: GROQ_API_KEY environment variable is not set.");
  process.exit(1);
}

const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT) || 3000;

const groq = new Groq({ apiKey });
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

const systemInstruction =
  "You are a helpful AI assistant. Be concise, friendly, and accurate.";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function requireDatabase(res) {
  if (supabase) return true;

  sendJson(res, 500, {
    error:
      "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to key.env, then restart the server.",
  });
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  try {
    const body = await readBody(req);
    const { chatId, content, messages } = JSON.parse(body || "{}");

    if (chatId && content) {
      if (!requireDatabase(res)) return;

      const chat = await getChatWithMessages(chatId);
      if (!chat) {
        sendJson(res, 404, { error: "Chat not found." });
        return;
      }

      const userContent = String(content).slice(0, 12_000);
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

      sendJson(res, 200, { message: reply });
      return;
    }

    if (!Array.isArray(messages)) {
      sendJson(res, 400, { error: "Messages must be an array." });
      return;
    }

    const cleanMessages = messages
      .filter((message) => message && typeof message.content === "string")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content.slice(0, 12_000),
      }));

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: systemInstruction }, ...cleanMessages],
    });

    sendJson(res, 200, {
      message: completion.choices[0]?.message?.content ?? "",
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}

async function getDefaultProfile() {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id, username, created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("profiles")
    .insert({ username: "You" })
    .select("id, username, created_at")
    .single();

  if (error) throw error;
  return data;
}

async function getChatWithMessages(chatId) {
  const { data: chat, error: chatError } = await supabase
    .from("chats")
    .select("id, title, created_at, updated_at")
    .eq("id", chatId)
    .maybeSingle();

  if (chatError) throw chatError;
  if (!chat) return null;

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (messagesError) throw messagesError;
  return { ...chat, messages: messages ?? [] };
}

async function insertMessage(chatId, role, content) {
  const { error } = await supabase
    .from("messages")
    .insert({ chat_id: chatId, role, content });

  if (error) throw error;
}

async function updateChatTitle(chatId, firstUserMessage) {
  const title = firstUserMessage.slice(0, 38) || "New chat";
  const { data: chat, error: chatError } = await supabase
    .from("chats")
    .select("title")
    .eq("id", chatId)
    .single();

  if (chatError) throw chatError;

  const payload = {
    updated_at: new Date().toISOString(),
    ...(chat.title === "New chat" ? { title } : {}),
  };

  const { error } = await supabase.from("chats").update(payload).eq("id", chatId);
  if (error) throw error;
}

async function handleState(req, res) {
  try {
    if (!requireDatabase(res)) return;

    const profile = await getDefaultProfile();
    const { data: chats, error: chatsError } = await supabase
      .from("chats")
      .select("id, title, created_at, updated_at")
      .eq("profile_id", profile.id)
      .order("updated_at", { ascending: false });

    if (chatsError) throw chatsError;

    const chatIds = (chats ?? []).map((chat) => chat.id);
    const { data: messages, error: messagesError } = chatIds.length
      ? await supabase
          .from("messages")
          .select("id, chat_id, role, content, created_at")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

    if (messagesError) throw messagesError;

    sendJson(res, 200, {
      profile,
      chats: (chats ?? []).map((chat) => ({
        ...chat,
        messages: (messages ?? []).filter((message) => message.chat_id === chat.id),
      })),
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}

async function handleCreateChat(req, res) {
  try {
    if (!requireDatabase(res)) return;

    const profile = await getDefaultProfile();
    const { data, error } = await supabase
      .from("chats")
      .insert({ profile_id: profile.id })
      .select("id, title, created_at, updated_at")
      .single();

    if (error) throw error;
    sendJson(res, 200, { chat: { ...data, messages: [] } });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}

async function handleClearChat(req, res, chatId) {
  try {
    if (!requireDatabase(res)) return;

    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("chat_id", chatId);

    if (deleteError) throw deleteError;

    const { error: updateError } = await supabase
      .from("chats")
      .update({ title: "New chat", updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (updateError) throw updateError;
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}

async function handleDeleteChat(req, res, chatId) {
  try {
    if (!requireDatabase(res)) return;

    const { error } = await supabase.from("chats").delete().eq("id", chatId);
    if (error) throw error;
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}

async function handleUpdateProfile(req, res) {
  try {
    if (!requireDatabase(res)) return;

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
    sendJson(res, 200, { profile: data });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/(clear|delete)$/);

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    handleState(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chats") {
    handleCreateChat(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/profile") {
    handleUpdateProfile(req, res);
    return;
  }

  if (req.method === "POST" && chatMatch?.[2] === "clear") {
    handleClearChat(req, res, chatMatch[1]);
    return;
  }

  if (req.method === "DELETE" && chatMatch?.[2] === "delete") {
    handleDeleteChat(req, res, chatMatch[1]);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Open http://localhost:${port} or stop the existing server.`);
    process.exit(1);
  }

  console.error(err.message || err);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`AI Agent web app running at http://localhost:${port}`);
});
