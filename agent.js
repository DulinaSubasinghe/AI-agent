import dotenv from "dotenv";
import Groq from "groq-sdk";
import { createReadStream, existsSync } from "fs";
import { extname, join } from "path";
import { fileURLToPath } from "url";
import http from "http";

dotenv.config({ path: "key.env", quiet: true });

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error("Error: GROQ_API_KEY environment variable is not set.");
  process.exit(1);
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT) || 3000;

const groq = new Groq({ apiKey });

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
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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
    const { messages } = JSON.parse(body || "{}");

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
