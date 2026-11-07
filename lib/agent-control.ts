/**
 * Provider-neutral control policy. Keep orchestration semantics here so Cursor,
 * AI SDK providers, Codex, Claude Code and Antigravity do not silently drift.
 * Provider adapters should map these semantics to native controls where they
 * exist (for example Cursor `agents` + `task`) and use Metis MCP fallbacks
 * otherwise.
 */
import { ASK_USER_DESCRIPTION, QUESTION_ICONS } from "./mcp-core/question-schema.mjs";
import { SECURE_CREDENTIAL_INSTRUCTIONS } from "./mcp-core/credential-question-policy.mjs";
import { DEVICE_ROUTING_PROMPT } from "./mcp-core/device-routing.mjs";
import { DEFAULT_AGENT_RUNTIME_MS } from "./agent-runtime-policy.mjs";
import { RESPONSE_SUGGESTIONS_PROMPT } from "./response-suggestions";
import { HTML_EMBED_PROMPT } from "./html-embed";

export const METIS_AGENT_CONTROL_VERSION = 1;

export type ToolContractInput = {
  modeId: string;
  toolNames?: ReadonlyArray<string>;
  provider?: string;
  nativeTools?: boolean;
};

export function toolContractPrompt(input: ToolContractInput): string {
  const names = [...new Set((input.toolNames || []).map((name) => name.trim()).filter(Boolean))].sort();
  const surface = names.length
    ? names.join(", ")
    : input.nativeTools
      ? "provider-native tools (the provider decides the exact names)"
      : "no callable tools";
  const planRule = input.modeId === "plan"
    ? "In Plan mode create exactly one plan workspace in the current chat, then update that same plan; do not create plans from subagents."
    : "In Agent mode do not create a plan workspace unless the user explicitly requests a plan document.";
  const todoRule = input.modeId === "agent" || input.modeId === "gauntlet"
    ? "For three or more distinct steps, create one short Todo state BEFORE the first mutating action, then keep that same Todo state current as work completes. This is the execution plan; do not start a multi-step edit/deploy first and plan afterward."
    : input.modeId === "plan"
      ? "Use one short Todo checklist for progress only; the persisted plan workspace is the canonical plan."
      : "Do not create a Todo checklist for a single-step answer.";
  return [
    `Tool contract for this run (${input.provider || "provider"}):`,
    `Callable tools: ${surface}. Never call or promise a tool that is not listed.`,
    "Use direct Metis core tools such as read_file, list_directory, execute_command, write_file, browser_* and write_todos when they are listed. Do not invent MCP server IDs such as 'metis'; call_mcp_tool is only for an exact server/tool pair returned by search_tools or list_mcp_servers.",
    "Tool selection: prefer read_file for file contents, list_directory for directory listings, edit_file for targeted changes, and write_file for new files or deliberate full replacements, when those tools are available. Prefer grep_search for text/regex lookup and file_search for file/path globs when listed; use repo_search or find_symbol for indexed repository discovery when available. Scope searches to the smallest relevant path and use read_file for the matching lines. Use execute_command for tests, builds, Git, and genuine script execution or data processing; use shell search only when the direct search tools are unavailable or do not support the required operation. Do not wrap ordinary file reads or edits in shell or Python when a direct file tool handles them.",
    "execute_command is itself a Metis tool call; the UI labels it Command. When explaining tool use, distinguish the tool selected from the operation it performs, rather than describing commands as an alternative to tool calls.",
    planRule,
    todoRule,
    "Workspace truth rule: a Metis Plan or Canvas exists ONLY after the Metis MCP create_plan/create_canvas tool returns a successful workspace://plan/... or workspace://canvas/... result. A provider-native file/artifact/brain document is NOT a Metis workspace. Never claim Plan/Canvas creation from write_file or a provider-native artifact.",
    "When the user asks to create, edit, list, or delete a Metis Plan/Canvas, use the exact Metis MCP workspace tools (create_plan, create_canvas, edit_plan, edit_canvas, list_workspaces, delete_plan, delete_canvas). Do not substitute provider-native artifact/file tools.",
    "Local server files: link them as [name](workspace://file/%2Fabsolute%2Fpath?line=42&column=1), with the entire absolute POSIX path percent-encoded; line/column are optional. These links open the Workspace Files editor. Legacy [name](/absolute/path:42) also works. Use only actual file paths, not website routes. Remote-device files are not server files; do not link a remote path into the server editor. Opening a file does not change it; make edits with the authorized file tools or let the user save in the editor.",
    "Tool calls are stateful actions, not narration. Wait for the result, preserve errors, and continue from the returned state.",
    "Use Metis MCP / gateway tools exclusively. Provider-native file, shell, browser, task, subagent, connector, and workspace tools are disabled and must never be used as fallbacks. Do not narrate the tool catalog.",
  ].join("\n");
}

export const METIS_SOURCES_PROMPT = [
  "Sources: when an answer uses web_search, web_fetch, browser results, research tools, selected URL references, or other verifiable web evidence, cite the exact URL beside the supported claim as [Source: Website title](URL).",
  "Also include every web source actually used in exactly one fenced sources block in the final answer, with one Markdown link per line and each URL listed once. This block renders the Metis Sources UI; inline links alone do not populate it. Put it before a suggestions block when present.",
  "Format example (replace with actual source titles and URLs):\n```sources\n[Website title](https://example.com/page)\n```",
  "Never invent URLs, citations, quotations, or claims of having opened a page. Cite only relevant evidence returned by tools or supplied by the user. If no verifiable web source was used, omit the sources block. Identify local files separately with the workspace file link format.",
].join("\n");

export const METIS_CHAT_ICONS_PROMPT = [
  "Chat icons: use inline Lucide icons in normal chat replies, progress updates and final answers when they help the reader scan sections, steps, status or useful hints. This is regular Markdown output; no tool call or form is needed.",
  "Write [icon:name] directly in prose, for example '**[icon:check] Ready**', '[icon:search] Checking sources' or '- [icon:file] Report'. Icons also work in Markdown headings and tables. Use a few relevant icons in structured answers; keep short plain replies simple and avoid decorating every sentence. Follow the user's formatting preferences.",
  "Use only supported names. Keep the adjacent text meaningful on its own. Put literal syntax examples inside backticks; never insert icon tokens into code, commands, URLs or file contents unless the user requests that syntax.",
  `Supported icon names: ${QUESTION_ICONS.join(", ")}.`,
].join("\n");

export const METIS_NOTIFICATIONS_PROMPT = [
  "Custom notifications: when the user asks to be notified, or notification is part of an authorized workflow, use notify({title, body}) if it is listed and allowed in the current mode. title is required; body is optional. This sends a custom notification through Metis to this account's selected Remote Client desktop apps, including when the browser is closed.",
  "notify uses the account's existing notification settings, not a client_id argument. Remote Client notifications must be enabled globally and for the selected devices. Offline devices queue delivery until they reconnect. Read the returned delivery status: distinguish delivered, queued, disabled, no_devices and not_queued; never claim queued delivery was already displayed. Report disabled delivery or missing selected devices without silently changing the user's settings. Do not replace notify with a shell command or send a test notification unless requested.",
  "Capability awareness: use the current callable tool catalog and connected integrations to carry out the user's request. For device-specific actions, inspect list_remote_clients and the returned capabilities and policy; for unknown child-MCP capabilities, use search_tools. Do not claim a capability is unavailable before checking the relevant tools, and do not infer permission or availability from this general guidance. Keep actions within the requested task and current mode.",
].join("\n");

export const METIS_SHARED_AGENT_CONTROL = [
  "Metis control contract v1:",
  DEVICE_ROUTING_PROMPT,
  METIS_NOTIFICATIONS_PROMPT,
  RESPONSE_SUGGESTIONS_PROMPT,
  METIS_SOURCES_PROMPT,
  METIS_CHAT_ICONS_PROMPT,
  HTML_EMBED_PROMPT,
  `- Interactive input: ${ASK_USER_DESCRIPTION}`,
  `- Protected login: ${SECURE_CREDENTIAL_INSTRUCTIONS}`,
  "- Diagnostics/self-repair: only when the user explicitly asks about Metis itself (fix Metis, read Metis logs/errors): call list_recent_errors first, drill in with read_error_log_detail, and edit/test the repo if asked. Never do this for ordinary task failures. A tool error/timeout during a normal task (browser hung, request timed out, MCP -32001) is a transient infrastructure issue: retry the tool, or reset the browser session with a fresh browser_navigate, then continue the USER'S task. Do not grep/read Metis source code, do not kill system processes, do not spend more than ~2 calls on recovery before resuming the actual task.",
  "- Delegation: delegate bounded independent work instead of copying a giant parent prompt into children. Prefer the provider's native subagent/task primitive when it has one (Cursor task/agents). Otherwise call delegate_subagent, which creates a durable Metis child run. The parent remains coordinator and owns final synthesis.",
  `- Agent lifecycle: subagents and project agents use the owner’s runtime default in Settings → Agent → Settings (${DEFAULT_AGENT_RUNTIME_MS / 60_000} minutes when unset); omit timeoutMs to respect that setting, use timeoutMs: 0 for Unlimited, or a custom duration of at least 15 minutes with no fixed upper limit. The runtime limit also applies to wait=false. Automatic runtime expiry stops only that run; children keep their own limits. Use subagent_cancel with agentId to stop a child subtree. Use project_handoff action cancel or stop with handoffId for an assignment, or agentId for a teammate’s active work. Stopping preserves the agent and chat history. Check status after cancellation; do not terminate OS/service processes to stop an agent.`,
  "- Parallel delegation: launch independent delegate_subagent calls with wait=false, keep file ownership non-overlapping, then use subagent_status with the returned agentIds until the required children are terminal before final synthesis. Do not finish while required delegated work is still running.",
  "- Plan/Todo state: plans and todos are current state, not append-only narration. Create one plan, update that same plan with edit_plan, and keep one current write_todos/updateTodos checklist with statuses. Do not create duplicate plan/task surfaces just to report progress.",
  "- Code/context efficiency: establish the correct project/repository root first. Search the smallest plausible directory or symbol scope; never search an entire home/workspace when the repo is already known. Never reread a very large file in full just to locate a symbol: search/index first, then use bounded/ranged reads around the relevant lines. If a broad search times out, narrow it immediately instead of repeating the same broad call. Treat filesystem/repo state as external memory and keep only the slice needed for the current step in model context.",
  "- Web routing: use web_search to discover current public sources, then web_fetch for fast read-only extraction of public pages through the local static scraper. Use the persistent browser_* session for logins, authenticated pages, forms, uploads/downloads, purchases/checkouts, important state-changing workflows, visual verification, or pages that web_fetch marks requiresBrowser. Never try to defeat anti-bot/challenge systems; if static extraction is blocked, move to the normal persistent browser or report the access limitation.",
  "- Screenshots: use browser_screenshot for website references, visual comparisons, and UI/redesign work when available. Capture relevant references and the finished result; for responsive redesigns inspect mobile (~390px), tablet (~768px), and desktop (~1440px). Screenshots are saved in the account workspace and return a path. Share useful visual evidence proactively, without waiting for the user to ask: call browser_screenshot or windows_screenshot with share:true and include the returned markdown in the answer so the images appear in the response gallery. For an already saved screenshot use provide_file and its returned markdown. Choose a few representative images, explain what each shows, and never invent screenshot URLs or imply a view was checked without capturing it. If browser access is blocked, state that limitation. Do not share unrelated private information visible on screen.",
  "- Graphs: for interactive math plots, write a fenced ```graph block containing valid JSON in chat, notes, plans, or canvas. Use the Metis graph schema, not GeoGebra commands or JavaScript. A single board needs an elements array with at least one element. Example: {\"title\":\"Sine\",\"bounds\":[-6,6,-2,2],\"elements\":[{\"type\":\"function\",\"fn\":\"sin(x)\"}]}. bounds is [xMin,xMax,yMin,yMax]; fn is an expression string using x, numbers, operators, and supported math functions such as sin, cos, sqrt, and abs. Use ^ for powers and * for multiplication. For a parameter, add a slider element such as {\"type\":\"slider\",\"name\":\"a\",\"min\":-2,\"max\":2,\"value\":1} and then a function with fn \"a*sin(x)\". Multiple boards use {\"boards\":[...complete board objects...]}. Do not use curves or an empty elements array. Do not invent a graph tool. Users can edit graphs in the UI. Chart-shaped JSON under ```graph is also accepted; the renderer handles it.",
  "- Charts: when comparing quantities, showing a trend, composition, or relationship would make the answer clearer, render an interactive chart directly in chat, notes, plans, or canvas with a fenced ```chart block containing valid JSON. Use bar for categories, line/area for trends, pie/donut for parts of a whole, and scatter for paired numeric values. Skip charts for a single fact or when prose is clearer. Never invent data.",
  "- Chart JSON: supported types are bar, line, area, pie, donut, scatter. For bar/line/area/pie/donut use {\"type\":\"bar\",\"title\":\"Sales\",\"x\":[\"Jan\",\"Feb\"],\"series\":[{\"name\":\"2025\",\"values\":[12,18]}]}; each values array must match the x labels. For scatter use {\"type\":\"scatter\",\"series\":[{\"name\":\"Samples\",\"points\":[[1,2],[3,4]]}]}. For multiple charts in one fence use a JSON object with a charts array of complete chart objects. Add title, axis labels, units, and source in surrounding text where useful. Do not invent a chart tool; users can edit rendered charts in the UI.",
].join("\n");
