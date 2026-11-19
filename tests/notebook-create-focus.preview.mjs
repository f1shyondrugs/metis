import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { importWorkerModule } from "../lib/worker-module.mjs";

const worktree = process.cwd(), out = path.resolve("output/notebook-create-focus");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "metis-note-create-focus-"));
const port = Number(process.argv[2] || 3266), origin = "http://127.0.0.1:" + port;
Object.assign(process.env, {
  AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: worktree, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, AI_CHAT_INTERNAL_ORIGIN: origin, CHAT_LEGACY_HEADER_AUTH: "false", METIS_AI_BOOTSTRAP_PASSWORD: "",
});
const [auth, notes, notesApi, noteApi, issuesApi, issueApi, issueViewApi, noteCollaboration, collab] = await Promise.all([
  "./auth.ts", "./shared-context.ts", "../app/api/notes/route.ts", "../app/api/notes/[id]/route.ts",
  "../app/api/issues/route.ts", "../app/api/issues/[id]/route.ts", "../app/api/issues/views/route.ts",
  "../app/api/notes/[id]/collaboration/route.ts", "./note-collaboration-server.ts",
].map(file => importWorkerModule(file)));
const password = "SYNTHETIC-NOTE-FOCUS-ONLY";
const user = auth.createUser("focus-fixture", password);
const cookie = "ai_chat_auth=" + auth.authenticateUser(user.username, password).token;
const existing = notes.createNote({ ownerId: user.id, title: "Open fixture note", content: "- [ ] Convert fixture task\n" });
const book = notes.createNote({ ownerId: user.id, title: "Focus fixture issuebook", content: "", kind: "issuebook" });
const service = collab.createNoteCollaborationServer();
const sockets = new WebSocketServer({ noServer: true });
fs.mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve("tsx"))("esbuild");
await build({
  entryPoints: ["tests/notebook-create-focus.browser.tsx"], outfile: out + "/app.js", bundle: true,
  platform: "browser", format: "esm", jsx: "automatic", tsconfig: worktree + "/tsconfig.json",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
});
const globalCss = worktree + "/app/globals.css";
const css = await postcss([tailwind()]).process(fs.readFileSync(globalCss, "utf8"), { from: globalCss });
fs.writeFileSync(out + "/theme.css", css.css);
fs.writeFileSync(out + "/browser.log", "");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin), method = req.method;
    const send = async response => { res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); };
    if (url.pathname === "/fixture") return await send(Response.json({ existing: existing.id, book: book.id }));
    if (url.pathname === "/") {
      return res.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html lang="en" class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notebook create focus fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (url.pathname === "/report" && method === "POST") {
      if (!/^(NO )?FOCUS [\w .-]{1,100}$/.test(body)) return res.writeHead(400).end();
      fs.appendFileSync(out + "/browser.log", body + "\n"); return res.writeHead(204).end();
    }
    if (url.pathname === "/api/projects") return await send(Response.json({ projects: [] }));
    const headers = new Headers(req.headers); headers.set("cookie", cookie);
    const request = new Request(url, { method, headers, body: body || undefined });
    const segments = url.pathname.split("/");
    const context = { params: Promise.resolve({ id: segments[3] }) };
    if (segments[2] === "notes") {
      if (!segments[3] && method === "POST" && JSON.parse(body).title === "Rejected fixture") return await send(Response.json({ error: "Fixture create rejected" }, { status: 409 }));
      if (!segments[3] && notesApi[method]) return await send(await notesApi[method](request));
      if (segments[4] === "collaboration") {
        if (notes.getNote(segments[3], user.id)?.title === "Delayed focus") await new Promise(resolve => setTimeout(resolve, 2000));
        return await send(await noteCollaboration.GET(request, context));
      }
      if (segments[3] && !segments[4] && noteApi[method]) {
        const response = await noteApi[method](request, context);
        if (method === "GET" && response.ok && notes.getNote(existing.id, user.id)?.content.includes("(issue://")) {
          fs.appendFileSync(out + "/browser.log", "SOURCE LINK SAVED\n");
        }
        return await send(response);
      }
    }
    if (segments[2] === "issues") {
      if (!segments[3] && issuesApi[method]) return await send(await issuesApi[method](request));
      if (segments[3] === "views" && issueViewApi[method]) return await send(await issueViewApi[method](request));
      if (!segments[4] && issueApi[method]) return await send(await issueApi[method](request, context));
    }
    const name = { "/app.js": "text/javascript", "/app.css": "text/css", "/theme.css": "text/css" }[url.pathname];
    if (name) return res.writeHead(200, { "Content-Type": name }).end(fs.readFileSync(out + url.pathname));
    res.writeHead(404).end();
  } catch (error) { console.error(error); res.writeHead(500).end(); }
});
server.on("upgrade",(req,socket,head)=>{
  if (req.url !== "/ws/notes") { socket.destroy(); return; }
  req.headers.cookie = cookie;
  sockets.handleUpgrade(req,socket,head,ws=>collab.handleNoteCollaborationConnection(service,ws,req));
});
server.listen(port, "127.0.0.1", () => console.log("NOTE_CREATE_FOCUS_PREVIEW_READY", port));
process.on("SIGTERM", () => {
  sockets.clients.forEach(client => client.terminate());
  server.close(() => { fs.rmSync(root, { recursive: true, force: true }); process.exit(0); });
});
