const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentConversationUrl = "";
let currentConversationId = "";
let selectedFiles = [];
let conversations = [];
let sending = false;
let currentUser = null;
let adminViewUserId = "";

// --- Auth ---

$("#password-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
$("#login-btn").addEventListener("click", login);
$("#register-btn").addEventListener("click", register);

async function login() {
  const username = $("#username-input").value.trim();
  const password = $("#password-input").value;
  $("#login-error").textContent = "";
  if (!username || !password) return;

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok) {
    currentUser = data.user;
    enterApp();
  } else {
    $("#login-error").textContent = data.error || "Login failed";
  }
}

async function register() {
  const username = $("#username-input").value.trim();
  const password = $("#password-input").value;
  $("#login-error").textContent = "";
  if (!username || !password) return;

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok) {
    currentUser = data.user;
    enterApp();
  } else {
    $("#login-error").textContent = data.error || "Registration failed";
  }
}

// Check auth on load
(async () => {
  const res = await fetch("/api/me");
  if (res.ok) {
    currentUser = await res.json();
    enterApp();
  }
})();

function enterApp() {
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-info").textContent = currentUser.username + (currentUser.role === "admin" ? " (admin)" : "");

  if (currentUser.role === "admin") {
    $("#admin-panel").classList.remove("hidden");
    loadAdminUsers();
  }
  loadConversations();
}

// Logout
$("#logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

// Sidebar toggle
$("#sidebar-toggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("collapsed");
});

// New chat
$("#new-chat-btn").addEventListener("click", () => {
  currentConversationUrl = "";
  currentConversationId = "";
  $("#chat-title").textContent = "New Chat";
  $("#chat-title").removeAttribute("data-custom");
  $("#messages").innerHTML =
    '<div class="welcome"><h2>Chat Oracle</h2><p>Send a message to start chatting with ChatGPT</p></div>';
  $$(".conv-item").forEach((el) => el.classList.remove("active"));
});

// File input
$("#file-input").addEventListener("change", (e) => {
  for (const f of e.target.files) selectedFiles.push(f);
  e.target.value = "";
  renderFilePreview();
});

function renderFilePreview() {
  const container = $("#file-preview");
  container.innerHTML = "";
  selectedFiles.forEach((f, i) => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.innerHTML = `<span>${f.name}</span><button data-idx="${i}">&times;</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      selectedFiles.splice(i, 1);
      renderFilePreview();
    });
    container.appendChild(chip);
  });
}

// --- Send message ---

$("#send-btn").addEventListener("click", sendMessage);
$("#message-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
$("#message-input").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 200) + "px";
});

async function sendMessage() {
  const input = $("#message-input");
  const message = input.value.trim();
  if (!message || sending) return;

  sending = true;
  $("#send-btn").disabled = true;

  const welcome = $(".welcome");
  if (welcome) welcome.remove();

  addMessage("user", message, selectedFiles.map((f) => f.name));

  const form = new FormData();
  form.append("message", message);

  const projectUrl = $("#project-url").value.trim();
  const chatUrl = currentConversationUrl || projectUrl;
  if (chatUrl) form.append("chatgptUrl", chatUrl);

  for (const f of selectedFiles) form.append("files", f);

  input.value = "";
  input.style.height = "auto";
  selectedFiles = [];
  renderFilePreview();

  const loadingEl = document.createElement("div");
  loadingEl.className = "loading-dots";
  loadingEl.innerHTML = "<span></span><span></span><span></span>";
  $("#messages").appendChild(loadingEl);
  scrollToBottom();

  try {
    const res = await fetch("/api/chat", { method: "POST", body: form });
    loadingEl.remove();

    if (!res.ok) {
      const err = await res.json();
      addMessage("assistant", `Error: ${err.error || "Request failed"}`);
      return;
    }

    const data = await res.json();
    addMessage("assistant", data.answer, null, data.conversationUrl, data.elapsed);

    if (data.conversationUrl) currentConversationUrl = data.conversationUrl;
    if (data.conversationId) currentConversationId = data.conversationId;
    if (!$("#chat-title").dataset.custom) {
      $("#chat-title").textContent = message.slice(0, 40) || "Chat";
    }
    loadConversations();
  } catch (err) {
    loadingEl.remove();
    addMessage("assistant", `Error: ${err.message}`);
  } finally {
    sending = false;
    $("#send-btn").disabled = false;
  }
}

// --- Message rendering ---

function addMessage(role, text, files, conversationUrl, elapsed) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  let html = "";

  if (files && files.length) {
    html += '<div class="msg-files">';
    for (const f of files) html += `<span class="msg-file-tag">${escapeHtml(f)}</span>`;
    html += "</div>";
  }

  html += escapeHtml(text);

  if (role === "assistant" && (conversationUrl || elapsed)) {
    html += '<div class="msg-meta">';
    if (elapsed) html += `${elapsed}`;
    if (conversationUrl) html += ` · <a href="${escapeHtml(conversationUrl)}" target="_blank">Open in ChatGPT</a>`;
    html += "</div>";
  }

  div.innerHTML = html;
  $("#messages").appendChild(div);
  scrollToBottom();
}

function renderMessages(messages, conversationUrl) {
  const container = $("#messages");
  container.innerHTML = "";
  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="welcome"><h2>Chat Oracle</h2><p>Continue this conversation</p></div>';
    return;
  }
  for (const msg of messages) {
    addMessage(msg.role, msg.text, msg.files, msg.role === "assistant" ? conversationUrl : null, msg.elapsed);
  }
}

function scrollToBottom() {
  const el = $("#messages");
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Conversations ---

async function loadConversations() {
  let url = "/api/conversations";
  if (currentUser.role === "admin" && adminViewUserId) {
    url = `/api/admin/conversations?userId=${adminViewUserId}`;
  } else if (currentUser.role === "admin" && adminViewUserId === "__all__") {
    url = "/api/admin/conversations";
  }

  const res = await fetch(url);
  if (res.ok) {
    conversations = await res.json();
    renderConversations();
  }
}

function renderConversations() {
  const list = $("#conversation-list");
  list.innerHTML = "";
  const isAdminView = currentUser.role === "admin" && adminViewUserId;

  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = "conv-item";
    if (conv.id === currentConversationId) item.classList.add("active");

    let title = escapeHtml(conv.title);
    if (isAdminView && conv.username) title = `<span class="conv-user">${escapeHtml(conv.username)}</span> ${title}`;

    item.innerHTML = `
      <span class="conv-title">${title}</span>
      <button class="conv-delete" title="Delete">&times;</button>
    `;
    item.querySelector(".conv-title").addEventListener("click", () => loadConversation(conv));
    item.querySelector(".conv-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/conversations/${conv.id}`, { method: "DELETE" });
      if (conv.id === currentConversationId) {
        currentConversationUrl = "";
        currentConversationId = "";
      }
      loadConversations();
    });
    list.appendChild(item);
  }
}

async function loadConversation(conv) {
  currentConversationId = conv.id;

  const isAdminView = currentUser.role === "admin" && adminViewUserId;
  const url = isAdminView ? `/api/admin/conversations/${conv.id}` : `/api/conversations/${conv.id}`;

  const res = await fetch(url);
  if (res.ok) {
    const full = await res.json();
    currentConversationUrl = full.conversationUrl;
    $("#chat-title").textContent = full.username ? `${full.username}: ${full.title}` : full.title;
    $("#chat-title").dataset.custom = "1";
    renderMessages(full.messages, full.conversationUrl);
  }
  renderConversations();
}

// --- Admin ---

async function loadAdminUsers() {
  const res = await fetch("/api/admin/users");
  if (!res.ok) return;
  const users = await res.json();
  const select = $("#user-filter");
  select.innerHTML = '<option value="">My Chats</option><option value="__all__">All Users</option>';
  for (const u of users) {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `${u.username}${u.role === "admin" ? " (admin)" : ""}`;
    select.appendChild(opt);
  }
}

$("#user-filter").addEventListener("change", (e) => {
  adminViewUserId = e.target.value;
  loadConversations();
});
