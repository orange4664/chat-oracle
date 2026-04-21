const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentConversationUrl = "";
let selectedFiles = [];
let conversations = [];
let sending = false;

// Auth
$("#password-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
$("#login-btn").addEventListener("click", login);

async function login() {
  const pw = $("#password-input").value;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    $("#login-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    loadConversations();
  } else {
    $("#login-error").textContent = "Wrong password";
  }
}

// Check auth on load
(async () => {
  const res = await fetch("/api/conversations");
  if (res.ok) {
    $("#login-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    conversations = await res.json();
    renderConversations();
  }
})();

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
  $("#chat-title").textContent = "New Chat";
  $("#messages").innerHTML =
    '<div class="welcome"><h2>Chat Oracle</h2><p>Send a message to start chatting with ChatGPT</p></div>';
  $$(".conv-item").forEach((el) => el.classList.remove("active"));
});

// File input
$("#file-input").addEventListener("change", (e) => {
  for (const f of e.target.files) {
    selectedFiles.push(f);
  }
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

// Send message
$("#send-btn").addEventListener("click", sendMessage);
$("#message-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
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

  // Clear welcome
  const welcome = $(".welcome");
  if (welcome) welcome.remove();

  // Add user message
  addMessage("user", message, selectedFiles.map((f) => f.name));

  // Build form data
  const form = new FormData();
  form.append("message", message);

  const projectUrl = $("#project-url").value.trim();
  const chatUrl = currentConversationUrl || projectUrl;
  if (chatUrl) form.append("chatgptUrl", chatUrl);

  for (const f of selectedFiles) {
    form.append("files", f);
  }

  input.value = "";
  input.style.height = "auto";
  selectedFiles = [];
  renderFilePreview();

  // Show loading
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

    if (data.conversationUrl) {
      currentConversationUrl = data.conversationUrl;
      if (!$("#chat-title").dataset.custom) {
        $("#chat-title").textContent = message.slice(0, 40) || "Chat";
      }
      loadConversations();
    }
  } catch (err) {
    loadingEl.remove();
    addMessage("assistant", `Error: ${err.message}`);
  } finally {
    sending = false;
    $("#send-btn").disabled = false;
  }
}

function addMessage(role, text, files, conversationUrl, elapsed) {
  const div = document.createElement("div");
  div.className = `message ${role}`;

  let html = "";

  if (files && files.length) {
    html += '<div class="msg-files">';
    for (const f of files) {
      html += `<span class="msg-file-tag">${escapeHtml(f)}</span>`;
    }
    html += "</div>";
  }

  html += escapeHtml(text);

  if (role === "assistant" && (conversationUrl || elapsed)) {
    html += '<div class="msg-meta">';
    if (elapsed) html += `${elapsed}`;
    if (conversationUrl) {
      html += ` · <a href="${escapeHtml(conversationUrl)}" target="_blank">Open in ChatGPT</a>`;
    }
    html += "</div>";
  }

  div.innerHTML = html;
  $("#messages").appendChild(div);
  scrollToBottom();
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

// Conversations
async function loadConversations() {
  const res = await fetch("/api/conversations");
  if (res.ok) {
    conversations = await res.json();
    renderConversations();
  }
}

function renderConversations() {
  const list = $("#conversation-list");
  list.innerHTML = "";
  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = "conv-item";
    if (conv.conversationUrl === currentConversationUrl) {
      item.classList.add("active");
    }
    item.innerHTML = `
      <span class="conv-title">${escapeHtml(conv.title)}</span>
      <button class="conv-delete" title="Delete">&times;</button>
    `;
    item.querySelector(".conv-title").addEventListener("click", () => {
      currentConversationUrl = conv.conversationUrl;
      $("#chat-title").textContent = conv.title;
      $("#chat-title").dataset.custom = "1";
      $("#messages").innerHTML =
        '<div class="welcome"><h2>' +
        escapeHtml(conv.title) +
        "</h2><p>Continue this conversation</p></div>";
      renderConversations();
    });
    item.querySelector(".conv-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/conversations/${conv.id}`, { method: "DELETE" });
      if (conv.conversationUrl === currentConversationUrl) {
        currentConversationUrl = "";
      }
      loadConversations();
    });
    list.appendChild(item);
  }
}
