// Synthetic local assets only. No production data, logins or external websites.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const output = path.resolve("output/favicon-links-ui");
fs.mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
await build({ entryPoints: ["tests/favicon-links.browser.tsx"], outfile: output + "/app.js", bundle: true, platform: "browser", format: "esm", jsx: "automatic", loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" }, define: { "process.env.NODE_ENV": '"production"' } });
const css = await postcss([tailwind()]).process(fs.readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
fs.writeFileSync(output + "/theme.css", css.css);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="#f97316" d="m16 2 4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/></svg>';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  res.setHeader("Cache-Control", "no-store");
  console.log(req.method, req.url);
  if (url.pathname === "/favicon.ico" || url.pathname === "/good.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.end(svg); return; }
  if (url.pathname === "/invalid.ico") { res.setHeader("Content-Type", "text/plain"); res.end("Not an image"); return; }
  if (url.pathname === "/missing.ico") { res.writeHead(404).end(); return; }
  if (url.pathname === "/api/link-preview") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ title: "Fixture website", favicon: "/good.svg" })); return; }
  if (url.pathname === "/report" && req.method === "POST") {
    let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 100000) { res.writeHead(413).end(); return; } }
    const report = JSON.parse(body); fs.writeFileSync(output + "/result-" + report.width + ".json", JSON.stringify(report, null, 2)); res.end("saved"); return;
  }
  if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<html lang="en" class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Favicon regression fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body style="background:#000;color:#fff"><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
  const name = path.basename(url.pathname);
  if (!/^(?:app\.(?:js|css)|theme\.css|[^/]+\.(?:woff2?|ttf))$/.test(name)) { res.writeHead(404).end(); return; }
  const file = path.join(output, name);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "application/octet-stream"); res.end(fs.readFileSync(file));
});
server.listen(3278, "127.0.0.1", () => console.log("FAVICON_FIXTURE_READY http://127.0.0.1:3278"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
