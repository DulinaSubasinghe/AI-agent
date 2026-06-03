import dotenv from "dotenv";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: join(__dirname, "../key.env"), quiet: true });

const apiKey = process.env.GROQ_API_KEY;
export const groq = new Groq({ apiKey });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

export function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

export function requireDatabase(res) {
  if (supabase) return true;

  sendJson(res, 500, {
    error:
      "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to environment variables.",
  });

  return false;
}

export function readBody(req) {
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

export async function getDefaultProfile() {
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

export async function getChatWithMessages(chatId) {
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

export async function insertMessage(chatId, role, content) {
  const { error } = await supabase
    .from("messages")
    .insert({ chat_id: chatId, role, content });

  if (error) throw error;
}

export async function updateChatTitle(chatId, firstUserMessage) {
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
