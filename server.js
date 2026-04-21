const express = require("express");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || "chat123";
const AUTH_COOKIE = "chat_oracle_auth";
const CONVERSATIONS_FILE = path.join(__dirname, "conversations.json");

const upload = multer({ dest: path.join(__dirname, "uploads") });

app.use(express.json());
app.use(cookieParser());

function loadConversations() {
  if (!fs.existsSync(CONVERSATIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveConversations(convs) {
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(convs, null, 2));
}

function requireAuth(req, res, next) {
  if (req.cookies[AUTH_COOKIE] === PASSWORD) return next();
  res.status(401).json({ error: "Unauthorized" });
}

app.post("/api/login", (req, res) => {
  if (req.body.password === PASSWORD) {
    res.cookie(AUTH_COOKIE, PASSWORD, { httpOnly: true, maxAge: 7 * 86400000 });
    return res.json({ ok: true });
  }
  res.status(403).json({ error: "Wrong password" });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});

app.get("/api/conversations", requireAuth, (req, res) => {
  res.json(loadConversations());
});

app.delete("/api/conversations/:id", requireAuth, (req, res) => {
  const convs = loadConversations().filter((c) => c.id !== req.params.id);
  saveConversations(convs);
  res.json({ ok: true });
});

app.post("/api/chat", requireAuth, upload.array("files", 10), (req, res) => {
  const { message, chatgptUrl } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  const args = buildOracleArgs(message, chatgptUrl, req.files);

  const timeout = 600000;
  execFile("oracle", args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    cleanupFiles(req.files);

    if (err && !stdout) {
      return res.status(500).json({ error: stderr || err.message });
    }

    const result = parseOracleOutput(stdout);

    if (result.conversationUrl) {
      const convs = loadConversations();
      const existing = convs.find((c) => c.conversationUrl === result.conversationUrl);
      if (existing) {
        existing.lastMessage = message.slice(0, 100);
        existing.updatedAt = new Date().toISOString();
      } else {
        convs.unshift({
          id: Date.now().toString(36),
          title: message.slice(0, 50),
          conversationUrl: result.conversationUrl,
          lastMessage: message.slice(0, 100),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      if (convs.length > 100) convs.length = 100;
      saveConversations(convs);
    }

    res.json(result);
  });
});

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

  return {
    answer: answer.trim(),
    conversationUrl,
    elapsed,
  };
}

function cleanupFiles(files) {
  if (!files) return;
  for (const f of files) {
    fs.unlink(f.path, () => {});
  }
}

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Chat Oracle running at http://localhost:${PORT}`);
  console.log(`Mode: ${process.env.ORACLE_MODE || "remote"}`);
});
