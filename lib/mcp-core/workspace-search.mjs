import { minimatch } from "minimatch";

export const SEARCH_PATH_PROPERTIES = {
  path: { type: "string", default: ".", description: "File or directory in the server agent workspace. Use the smallest relevant scope." },
  include_hidden: { type: "boolean", default: false },
  include_ignored: { type: "boolean", default: false, description: "Include dependency/build folders normally skipped by this tool. Git metadata is always excluded; symlinks are not followed." },
  limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
};
export const WORKSPACE_SEARCH_TOOLS = [
  {
    name: "grep_search",
    description: "Search text in workspace files directly. Prefer this over terminal rg/grep for normal text lookup. Returns bounded structured matches with file paths, line numbers and optional context. Literal text by default; regex is opt-in. Skips binary/oversized files, hidden files and common dependency/build folders by default. No ripgrep or Python installation is required.",
    inputSchema: { type: "object", properties: { ...SEARCH_PATH_PROPERTIES,
      pattern: { type: "string", minLength: 1, maxLength: 2000 },
      regex: { type: "boolean", default: false },
      case_sensitive: { type: "boolean", default: true },
      glob: { type: "string", default: "**/*", description: "Optional file glob, e.g. **/*.tsx or **/*.{ts,tsx}. Forward slashes on every OS." },
      context_lines: { type: "integer", minimum: 0, maximum: 3, default: 0 },
    }, required: ["pattern"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "file_search",
    description: "Find workspace files by glob/path pattern, e.g. **/*.tsx or *config*. Prefer this over terminal rg --files/find for ordinary file discovery. Returns bounded structured file paths. Hidden files and common dependency/build folders are skipped by default; symlinks are not followed. Available without a repository index or extra system packages.",
    inputSchema: { type: "object", properties: { ...SEARCH_PATH_PROPERTIES,
      pattern: { type: "string", minLength: 1, maxLength: 512 },
    }, required: ["pattern"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

export function normalizeWorkspaceSearch(name, args) {
  if (!["grep_search", "file_search"].includes(name)) throw new Error("Unknown workspace search");
  if (typeof args.pattern !== "string" || !args.pattern || args.pattern.length > 2000) throw new Error("pattern must be a nonempty string of at most 2000 characters");
  if (args.path != null && (typeof args.path !== "string" || !args.path.trim() || args.path.includes("\0"))) throw new Error("Invalid search path");
  const limit = args.limit ?? 100, contextLines = args.context_lines ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200");
  if (!Number.isSafeInteger(contextLines) || contextLines < 0 || contextLines > 3) throw new Error("context_lines must be between 0 and 3");
  for (const key of ["regex", "case_sensitive", "include_hidden", "include_ignored"]) if (args[key] != null && typeof args[key] !== "boolean") throw new Error(key + " must be a boolean");
  const glob = name === "file_search" ? args.pattern : (args.glob ?? "**/*");
  if (typeof glob !== "string" || !glob || glob.length > 512 || (glob.match(/\{/g) || []).length > 4 || (glob.match(/,/g) || []).length > 16) throw new Error("Use a shorter, simpler file glob");
  // Match a basename pattern anywhere in the selected tree.
  const globPattern = glob.includes("/") ? glob : "**/" + glob;
  const matcher = minimatch.makeRe(globPattern, { dot: args.include_hidden === true, nonegate: true, nocomment: true, noext: true });
  if (!matcher) throw new Error("Invalid file glob");
  if (args.regex === true) new RegExp(args.pattern, args.case_sensitive === false ? "i" : "");
  return { name, path: args.path || ".", pattern: args.pattern, glob, globSource: matcher.source,
    regex: args.regex === true, caseSensitive: args.case_sensitive !== false, includeHidden: args.include_hidden === true,
    includeIgnored: args.include_ignored === true, limit, contextLines };
}

/** Self-contained Node worker: serialized so unprivileged accounts need no access to the app checkout. */
function executeWorkspaceSearch(fs, path, request) {
  const started = Date.now(), files = [], matches = [], skipped = { binary: 0, oversized: 0, unreadable: 0, symlinks: 0 };
  const limits = [], common = new Set(["node_modules", "dist", "build", "coverage", ".next", ".next-a", ".next-b", ".cache", "__pycache__", "vendor"]);
  let scannedFiles = 0, visited = 0, readBytes = 0, outputBytes = 0, stopped = false;
  const inside = (root, value) => { const relative = path.relative(root, value); return !relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)); };
  const root = fs.realpathSync(request.path);
  if (request.workspace && !inside(fs.realpathSync(request.workspace), root)) throw new Error("Search path must stay inside the agent workspace");
  if (fs.lstatSync(request.path).isSymbolicLink()) throw new Error("Search paths must not be symlinks");
  const rootStat = fs.statSync(root);
  if (!rootStat.isDirectory() && !rootStat.isFile()) throw new Error("Search path must be a file or directory");
  const glob = new RegExp(request.globSource);
  const regex = request.regex ? new RegExp(request.pattern, request.caseSensitive ? "" : "i") : null;
  const literal = request.caseSensitive ? request.pattern : request.pattern.toLowerCase();
  function stop(reason) { if (!limits.includes(reason)) limits.push(reason); stopped = true; }
  function budget() {
    if (stopped) return false;
    if (Date.now() - started > 5000) stop("time");
    if (visited >= 40000 || scannedFiles >= 10000) stop("scan");
    if (readBytes >= 64 * 1024 * 1024) stop("bytes");
    return !stopped;
  }
  function append(list, value) {
    if (list.length >= request.limit) { stop("results"); return false; }
    const size = Buffer.byteLength(JSON.stringify(value));
    if (outputBytes + size > 192 * 1024) { stop("output"); return false; }
    outputBytes += size; list.push(value); return true;
  }
  function inspect(absolute, relative) {
    if (!budget()) return;
    scannedFiles++;
    if (!glob.test(relative)) return;
    try {
      // Recheck containment before opening to avoid reading directory symlink escapes.
      const real = fs.realpathSync(absolute);
      if (!inside(rootStat.isDirectory() ? root : path.dirname(root), real) || fs.lstatSync(absolute).isSymbolicLink()) { skipped.symlinks++; return; }
      if (request.name === "file_search") { append(files, { path: relative, absolutePath: real }); return; }
      let fd;
      try {
        fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) return;
        if (stat.size > 2 * 1024 * 1024) { skipped.oversized++; return; }
        if (readBytes + stat.size > 64 * 1024 * 1024) { stop("bytes"); return; }
        const bytes = fs.readFileSync(fd); readBytes += bytes.length;
        if (bytes.includes(0)) { skipped.binary++; return; }
        const text = bytes.toString("utf8");
        if (!Buffer.from(text, "utf8").equals(bytes)) { skipped.binary++; return; }
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length && budget(); index++) {
          const line = lines[index], probe = request.caseSensitive ? line : line.toLowerCase();
          const found = regex ? regex.exec(line) : null;
          const column = regex ? (found ? found.index : -1) : probe.indexOf(literal);
          if (column < 0) continue;
          const clipStart = Math.max(0, column - 250);
          const content = line.slice(clipStart, clipStart + 1500);
          const context = [];
          for (let row = Math.max(0, index - request.contextLines); row <= Math.min(lines.length - 1, index + request.contextLines); row++) {
            if (row !== index) context.push({ line: row + 1, text: lines[row].slice(0, 1500) });
          }
          if (!append(matches, { path: relative, absolutePath: real, line: index + 1, column: column + 1,
            text: content, ...(clipStart || line.length > content.length ? { textTruncated: true } : {}), ...(context.length ? { context } : {}) })) break;
        }
      } finally { if (fd !== undefined) fs.closeSync(fd); }
    } catch (error) { if (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOENT") skipped.unreadable++; else throw error; }
  }
  const folders = [{ directory: root, depth: 0 }];
  function walk(directory, depth) {
    if (!budget()) return;
    if (depth > 64) { if (!limits.includes("depth")) limits.push("depth"); return; }
    let dir;
    try {
      dir = fs.opendirSync(directory);
      let entry;
      while (budget() && (entry = dir.readSync())) {
        visited++;
        if (entry.name === ".git") continue;
        if (!request.includeHidden && entry.name.startsWith(".")) continue;
        if (!request.includeIgnored && (common.has(entry.name) || entry.name.startsWith(".next-"))) continue;
        if (entry.isSymbolicLink()) { skipped.symlinks++; continue; }
        const absolute = path.join(directory, entry.name), relative = path.relative(root, absolute).split(path.sep).join("/");
        if (entry.isDirectory()) {
          // Give names in this folder (e.g. a root dotfile) a chance before
          // a descendant exhausts the scan or result budget.
          if (request.name === "file_search") folders.push({ directory: absolute, depth: depth + 1 });
          else walk(absolute, depth + 1);
        } else if (entry.isFile()) inspect(absolute, relative);
      }
    } catch (error) { if (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOENT") skipped.unreadable++; else throw error; }
    finally { if (dir) dir.closeSync(); }
  }
  if (!rootStat.isDirectory()) inspect(root, path.basename(root));
  else {
    for (let i = 0; i < folders.length && budget(); i++) walk(folders[i].directory, folders[i].depth);
  }
  const results = request.name === "file_search" ? files : matches;
  results.sort((a, b) => a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0));
  return { type: request.name === "file_search" ? "file_search" : "text_search", root, pattern: request.pattern,
    ...(request.name === "grep_search" ? { glob: request.glob } : {}), count: results.length,
    ...(request.name === "file_search" ? { files } : { matches }), truncated: limits.length > 0, limits,
    scannedFiles, skipped, durationMs: Date.now() - started };
}

export function buildWorkspaceSearchProgram(request) {
  return "const runSearch = (" + executeWorkspaceSearch.toString() + ");\ntry { console.log(JSON.stringify(runSearch(require('node:fs'),require('node:path'),JSON.parse(Buffer.from('" +
    Buffer.from(JSON.stringify(request), "utf8").toString("base64") + "','base64').toString('utf8'))))); } catch(error) { console.error(error.message); process.exitCode=1; }";
}
