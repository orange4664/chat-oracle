const express = require("express");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "chat-oracle-default-secret";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const AUTH_COOKIE = "chat_oracle_auth";
const USERS_FILE = path.join(__dirname, "users.json");
const CONVERSATIONS_FILE = path.join(__dirname, "conversations.json");

const upload = multer({ dest: path.join(__dirname, "uploads") });

app.use(express.json());
app.use(cookieParser());

// --- Data helpers ---

function loadJSON(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadUsers() { return loadJSON(USERS_FILE); }
function saveUsers(u) { saveJSON(USERS_FILE, u); }
function loadConversations() { return loadJSON(CONVERSATIONS_FILE); }
function saveConversations(c) { saveJSON(CONVERSATIONS_FILE, c); }

// --- Auth helpers ---

function signCookie(userId) {
  const hmac = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}:${hmac}`;
}

function verifyCookie(cookie) {
  if (!cookie) return null;
  const [userId, hmac] = cookie.split(":");
  if (!userId || !hmac) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  if (hmac !== expected) return null;
  return userId;
}

function requireAuth(req, res, next) {
  const userId = verifyCookie(req.cookies[AUTH_COOKIE]);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const user = loadUsers().find((u) => u.id === userId);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// --- Auth APIs ---

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: "Username must be 2-20 characters" });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

  const users = loadUsers();
  if (users.find((u) => u.username === username)) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const role = username === ADMIN_USERNAME ? "admin" : "user";
  const user = {
    id: crypto.randomBytes(8).toString("hex"),
    username,
    password: hashed,
    role,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);

  res.cookie(AUTH_COOKIE, signCookie(user.id), { httpOnly: true, maxAge: 7 * 86400000 });
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(403).json({ error: "Wrong username or password" });
  }

  res.cookie(AUTH_COOKIE, signCookie(user.id), { httpOnly: true, maxAge: 7 * 86400000 });
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json(req.user);
});

// --- Conversation APIs ---

app.get("/api/conversations", requireAuth, (req, res) => {
  const convs = loadConversations()
    .filter((c) => c.userId === req.user.id)
    .map(({ messages, ...rest }) => rest);
  res.json(convs);
});

app.get("/api/conversations/:id", requireAuth, (req, res) => {
  const conv = loadConversations().find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  if (conv.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json(conv);
});

app.delete("/api/conversations/:id", requireAuth, (req, res) => {
  const convs = loadConversations();
  const idx = convs.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  if (convs[idx].userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  convs.splice(idx, 1);
  saveConversations(convs);
  res.json({ ok: true });
});

// --- Admin APIs ---

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const users = loadUsers().map(({ password, ...rest }) => rest);
  res.json(users);
});

app.get("/api/admin/conversations", requireAuth, requireAdmin, (req, res) => {
  const users = loadUsers();
  const userMap = {};
  for (const u of users) userMap[u.id] = u.username;

  const filterUserId = req.query.userId;
  let convs = loadConversations();
  if (filterUserId) convs = convs.filter((c) => c.userId === filterUserId);

  res.json(convs.map(({ messages, ...rest }) => ({ ...rest, username: userMap[rest.userId] || "unknown" })));
});

app.get("/api/admin/conversations/:id", requireAuth, requireAdmin, (req, res) => {
  const conv = loadConversations().find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  const users = loadUsers();
  const user = users.find((u) => u.id === conv.userId);
  res.json({ ...conv, username: user ? user.username : "unknown" });
});

// --- Chat API ---

app.post("/api/chat", requireAuth, upload.array("files", 10), (req, res) => {
  const { message, chatgptUrl } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  const args = buildOracleArgs(message, chatgptUrl, req.files);
  const timeout = 600000;

  execFile("oracle", args, { timeout, maxBuffer: 10 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
    cleanupFiles(req.files);

    if (err && !stdout) {
      return res.status(500).json({ error: stderr || err.message });
    }

    const result = parseOracleOutput(stdout);
    const convs = loadConversations();

    const userMsg = {
      role: "user",
      text: message,
      files: req.files ? req.files.map((f) => f.originalname) : [],
      timestamp: new Date().toISOString(),
    };
    const assistantMsg = {
      role: "assistant",
      text: result.answer,
      elapsed: result.elapsed,
      timestamp: new Date().toISOString(),
    };

    let convId;
    if (result.conversationUrl) {
      const existing = convs.find((c) => c.conversationUrl === result.conversationUrl && c.userId === req.user.id);
      if (existing) {
        existing.messages.push(userMsg, assistantMsg);
        existing.lastMessage = message.slice(0, 100);
        existing.updatedAt = new Date().toISOString();
        convId = existing.id;
      } else {
        convId = Date.now().toString(36);
        convs.unshift({
          id: convId,
          userId: req.user.id,
          title: message.slice(0, 50),
          conversationUrl: result.conversationUrl,
          messages: [userMsg, assistantMsg],
          lastMessage: message.slice(0, 100),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      convId = Date.now().toString(36);
      convs.unshift({
        id: convId,
        userId: req.user.id,
        title: message.slice(0, 50),
        conversationUrl: "",
        messages: [userMsg, assistantMsg],
        lastMessage: message.slice(0, 100),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    if (convs.length > 500) convs.length = 500;
    saveConversations(convs);

    res.json({ ...result, conversationId: convId });
  });
});

// --- Oracle helpers ---

function buildOracleArgs(message, chatgptUrl, files) {
  const args = [];
  const mode = process.env.ORACLE_MODE || "remote";

  if (mode === "remote") {
    const host = process.env.ORACLE_REMOTE_HOST;
    const token = process.env.ORACLE_REMOTE_TOKEN;
    if (host) args.push("--remote-host", host);
    if (token) args.push("--remote-token", token);
  } else {
    args.push("--engine", "browser");
  }

  const url = chatgptUrl || process.env.ORACLE_DEFAULT_PROJECT || "";
  if (url) args.push("--chatgpt-url", url);

  if (files && files.length > 0) {
    args.push("--browser-attachments", "always");
    for (const f of files) {
      args.push("--file", f.path);
    }
  }

  args.push("-p", message);
  return args;
}

function parseOracleOutput(stdout) {
  const lines = stdout.split("\n");
  let answer = "";
  let conversationUrl = "";
  let elapsed = "";
  let inAnswer = false;

  for (const line of lines) {
    if (line.startsWith("Answer:")) {
      inAnswer = true;
      continue;
    }
    if (line.startsWith("Conversation URL:")) {
      conversationUrl = line.replace("Conversation URL:", "").trim();
      inAnswer = false;
      continue;
    }
    const elapsedMatch = line.match(/^(\d+\.\d+s)\s+·/);
    if (elapsedMatch) {
      elapsed = elapsedMatch[1];
      inAnswer = false;
      continue;
    }
    if (line.includes("Launching browser mode") || line.includes("This run can take")) {
      continue;
    }
    if (inAnswer) {
      answer += line + "\n";
    }
  }

  return { answer: answer.trim(), conversationUrl, elapsed };
}

function cleanupFiles(files) {
  if (!files) return;
  for (const f of files) {
    fs.unlink(f.path, () => {});
  }
}

// --- Static ---

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Chat Oracle running at http://localhost:${PORT}`);
  console.log(`Mode: ${process.env.ORACLE_MODE || "remote"}`);
  console.log(`Admin username: ${ADMIN_USERNAME}`);
});
