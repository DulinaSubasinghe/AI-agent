const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const messagesEl = document.querySelector("#messages");
const emptyState = document.querySelector("#emptyState");
const sendButton = document.querySelector("#sendButton");
const newChatButton = document.querySelector("#newChatButton");

let messages = [];
let isSending = false;

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function setSending(nextState) {
  isSending = nextState;
  sendButton.disabled = nextState || !input.value.trim();
}

function renderMessage(role, content, options = {}) {
  emptyState.hidden = true;

  const message = document.createElement("article");
  message.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "assistant" ? "NPC" : "P1";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const label = document.createElement("div");
  label.className = "role";
  label.textContent = role === "assistant" ? "NPC Assistant" : "Player 1";

  const body = document.createElement("div");
  if (options.loading) {
    body.className = "typing";
    body.innerHTML = "<span></span><span></span><span></span>";
  } else {
    body.textContent = content;
  }

  bubble.append(label, body);
  message.append(avatar, bubble);
  messagesEl.append(message);
  scrollToBottom();

  return { message, body };
}

async function sendMessage(content) {
  messages.push({ role: "user", content });
  renderMessage("user", content);

  const loadingMessage = renderMessage("assistant", "", { loading: true });
  setSending(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "The request failed.");
    }

    messages.push({ role: "assistant", content: data.message });
    loadingMessage.body.className = "";
    loadingMessage.body.textContent = data.message;
  } catch (err) {
    messages.pop();
    loadingMessage.body.className = "";
    loadingMessage.body.textContent = `Error: ${err.message}`;
  } finally {
    setSending(false);
    scrollToBottom();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const content = input.value.trim();
  if (!content || isSending) return;

  input.value = "";
  resizeInput();
  sendButton.disabled = true;
  sendMessage(content);
});

input.addEventListener("input", () => {
  resizeInput();
  sendButton.disabled = isSending || !input.value.trim();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

newChatButton.addEventListener("click", () => {
  messages = [];
  messagesEl.querySelectorAll(".message").forEach((message) => message.remove());
  emptyState.hidden = false;
  input.value = "";
  resizeInput();
  setSending(false);
  input.focus();
});

setSending(false);
resizeInput();
