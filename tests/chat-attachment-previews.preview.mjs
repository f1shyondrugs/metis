// Component-only browser fixture; it never boots an app server or reads account data.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const tmp = await mkdtemp(path.join(os.tmpdir(), "metis-attachment-preview-"));
try {
  await build({
    entryPoints: ["tests/chat-attachment-previews.browser.tsx"],
    outfile: path.join(tmp, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const styles = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
  const appCss = await readFile(path.join(tmp, "fixture.css")).catch(() => Buffer.from(""));
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#8faed0"/><circle cx="466" cy="84" r="36" fill="#ffe5b0"/>
    <path d="M0 284 176 79 372 292 501 161 640 298V360H0Z" fill="#485e84"/>
    <path d="m126 139 50-60 63 70-54-15-26 18z" fill="#e7eef8"/>
    <path d="M0 309Q170 258 310 310T640 291V360H0Z" fill="#263b59"/>
  </svg>`)).png().toBuffer();
  const index = '<!doctype html><html class="dark" lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chat attachment preview</title><link rel="stylesheet" href="/theme.css"><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
  const assets = new Map([
    ["/", ["text/html; charset=utf-8", index]],
    ["/theme.css", ["text/css", styles.css + appCss.toString()]],
    ["/fixture.js", ["text/javascript", await readFile(path.join(tmp, "fixture.js"))]],
    ["/api/file-uploads/11111111-1111-4111-8111-111111111111/file", ["image/png", png]],
    ["/api/uploads/fixture-chat/fixture%20notes.txt", ["text/plain", "Review notes\n\nOriginal text from the queued attachment."]],
  ]);
  const server = http.createServer((req, res) => {
    const asset = assets.get(new URL(req.url, "http://localhost").pathname);
    if (!asset) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", asset[0]);
    res.end(asset[1]);
  });
  server.listen(Number(process.env.PORT || 3272), "127.0.0.1", () => console.log("ATTACHMENT_PREVIEW_FIXTURE_READY"));
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    process.once("SIGTERM", () => server.close(resolve));
    process.once("SIGINT", () => server.close(resolve));
  });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
