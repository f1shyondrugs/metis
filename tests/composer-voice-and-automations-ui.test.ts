import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { internalLinkNavigation, parseInternalLink } from "../lib/internal-link";

const shellSource = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);
const markdownSource = readFileSync(
  new URL("../components/markdown.tsx", import.meta.url),
  "utf8",
);
const voiceSource = readFileSync(
  new URL("../components/voice-input.tsx", import.meta.url),
  "utf8",
);
const clientConfigSource = readFileSync(
  new URL("../lib/client-config.ts", import.meta.url),
  "utf8",
);
const automationsSource = readFileSync(
  new URL("../components/automations-panel.tsx", import.meta.url),
  "utf8",
);
const globalCssSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const chipSource = readFileSync(
  new URL("../components/tool-call-chip.tsx", import.meta.url),
  "utf8",
);
const toolPreviewSource = readFileSync(
  new URL("../components/tool-call-preview.tsx", import.meta.url),
  "utf8",
);
const quotaSource = readFileSync(
  new URL("../components/quota-gauges.tsx", import.meta.url),
  "utf8",
);

test("automation markdown links dispatch open-automations and the shell opens the tab", () => {
  const target = parseInternalLink("automation://linked-automation")!;
  assert.deepEqual(internalLinkNavigation(target), {
    href: "#automation-linked-automation", event: "ai-chat:open-automations", detail: { id: "linked-automation" },
  });
  assert.match(markdownSource, /internalLinkNavigation\(internalTarget\)/);
  assert.match(markdownSource, /window\.dispatchEvent\(new CustomEvent\(navigation\.event, \{ detail: navigation\.detail \}\)\)/);
  assert.match(chipSource, /<ToolCallPreview tool=/);
  assert.match(toolPreviewSource, /new CustomEvent\("ai-chat:open-automations", \{ detail: \{ id: automation\.id \} \}\)/);
  assert.match(shellSource, /ai-chat:open-automations/);
  assert.match(shellSource, /const openLinkedAutomation/);
  assert.match(shellSource, /navigateChat\("automations"\)/);
  assert.match(shellSource, /setFocusedAutomationId\(id\)/);
  assert.match(shellSource, /highlightId=\{focusedAutomationId\}/);
});

test("automations panel can focus a linked automation by id", () => {
  assert.match(automationsSource, /id=\{`automation-\$\{automation\.id\}`\}/);
  assert.match(automationsSource, /handledHighlightRef\.current = highlightId/);
  assert.match(automationsSource, /setSelectedId\(highlightId\)/);
  assert.match(automationsSource, /SELECTED_AUTOMATION_KEY/);
});

test("voice composer exposes cancel via the plus button and drops stale waveform state", () => {
  assert.match(voiceSource, /cancelSignal\?: number/);
  assert.match(voiceSource, /lastCancelSignalRef/);
  assert.match(voiceSource, /onStateChange\?\.\("idle"\)/);
  assert.match(shellSource, /cancelSignal=\{voiceCancelSignal\}/);
  assert.match(shellSource, /const resetVoiceComposer/);
  assert.match(shellSource, /Cancel voice input/);
  assert.match(shellSource, /<X className="size-4" \/>/);
  assert.match(shellSource, /voiceRecording && voiceState === "recording"/);
  assert.match(shellSource, /\[activeChatId, automationsOpen, notesOpen\]/);
  assert.match(shellSource, /composerTranscriptInsert/);
  assert.match(shellSource, /setComposerSyncNonce/);
  assert.match(shellSource, /paintVoiceWaveform/);
});

test("voice recording keeps the parent waveform callback stable across recording renders", () => {
  assert.match(shellSource, /const handleVoiceWaveformLevelChange = useCallback\(\(level: number\) => \{/);
  assert.match(shellSource, /onWaveformLevelChange=\{handleVoiceWaveformLevelChange\}/);
  assert.doesNotMatch(shellSource, /onWaveformLevelChange=\{\(level\) => paintVoiceWaveform/);
});

test("login starts with an empty username and exposes an accessible password visibility toggle", () => {
  assert.match(clientConfigSource, /NEXT_PUBLIC_CHAT_USERNAME\?\.trim\(\) \|\| ""/);
  assert.doesNotMatch(clientConfigSource, /\|\| "admin"/);
  const loginSource=readFileSync(new URL("../components/sign-in-screen.tsx",import.meta.url),"utf8");
  assert.match(shellSource, /<SignInScreen/);
  assert.match(loginSource, /type=\{visible\?"text":"password"\}/);
  assert.match(loginSource, /aria-label=\{visible\?"Hide password":"Show password"\}/);
  assert.match(loginSource, /<EyeOff[^>]+aria-hidden/);
  assert.match(loginSource, /loginErrorMessage\(response.status,body.error\)/);
  assert.match(loginSource, /loginErrorMessage\(\)/);
  assert.match(loginSource, /<p role="alert" aria-live="polite"/);
});

test("agent completion uses the bundled default sound unless a custom sound is set", () => {
  const settingsSource = readFileSync(
    new URL("../components/settings-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shellSource, /const DEFAULT_FINISH_SOUND_URL = "\/sounds\/agent-completion\.mp3"/);
  assert.match(shellSource, /finishSound\?\.dataUrl \|\| DEFAULT_FINISH_SOUND_URL/);
  assert.doesNotMatch(shellSource, /createOscillator/);
  assert.match(settingsSource, /Removing a custom file restores that default/);
  assert.ok(
    existsSync(new URL("../public/sounds/agent-completion.mp3", import.meta.url)),
    "default completion sound must be shipped",
  );
});

test("automations use the full-height demo split view without a composer or workspace panel", () => {
  const splitViewSource = readFileSync(new URL("../components/automation-editor-surface.tsx", import.meta.url), "utf8");
  assert.match(splitViewSource, /data-slot="automations-split-view"/);
  assert.match(globalCssSource, /grid-template-columns: minmax\(0, 1fr\) var\(--automation-detail-width, 480px\)/);
  assert.match(globalCssSource, /@media \(max-width: 900px\)[\s\S]*grid-template-rows: minmax\(210px, 36%\) minmax\(0, 1fr\)/);
  assert.match(globalCssSource, /\.automation-detail-content \{[\s\S]*?max-width: none;/);
  assert.match(globalCssSource, /\.automation-detail-content \{[\s\S]*?padding: 18px 12px 24px 18px;/);
  assert.doesNotMatch(globalCssSource, /\.automation-detail-content \{[\s\S]*?max-width: 520px/);
  assert.match(shellSource, /automationsOpen \? \([\s\S]*?h-full min-h-0 flex-1 overflow-hidden[\s\S]*?<AutomationsPanel/);
  assert.match(shellSource, /!notesOpen && !automationsOpen && workspaceMounted/);
  assert.doesNotMatch(automationsSource, /Search automations|AutomationGraphView|NoteProjectMenu/);
});

test("automations expose a direct create action and submit through the existing editor", () => {
  assert.match(automationsSource, /aria-label="Create automation"/);
  assert.match(automationsSource, /<Plus aria-hidden="true" \/>/);
  assert.match(automationsSource, /creating \? "\/api\/automations"/);
  assert.match(automationsSource, /method: creating \? "POST" : "PATCH"/);
  assert.match(automationsSource, /creating \? "Create automation" : "Save changes"/);
  assert.match(automationsSource, /Automation created/);
  assert.match(globalCssSource, /\.automation-create-button \{/);
});

test("automation detail exposes live run, pause and resume actions", () => {
  assert.match(automationsSource, /method: "PATCH"/);
  assert.match(automationsSource, /JSON\.stringify\(\{ action \}\)/);
  assert.match(automationsSource, /mutate\(currentDetail, "run"\)/);
  assert.match(automationsSource, /currentDetail\.status === "active" \? "pause" : "resume"/);
  assert.match(automationsSource, /automation-run-history/);
});

test("automation detail can edit and delete, and shows prompt and model under the stats grid", () => {
  assert.match(automationsSource, /method: "DELETE"/);
  assert.match(automationsSource, /beginEdit\(currentDetail\)/);
  assert.match(automationsSource, /Save changes/);
  assert.match(automationsSource, /Delete automation/);
  assert.match(automationsSource, /automation-stats-grid[\s\S]*automation-facts[\s\S]*Prompt[\s\S]*Model/);
  assert.match(automationsSource, /aria-label=\{`Edit \$\{automation\.name\}`\}/);
  assert.match(automationsSource, /aria-label=\{`Delete \$\{automation\.name\}`\}/);
  assert.match(shellSource, /models=\{models\}/);
  assert.match(globalCssSource, /\.automation-facts \{/);
  assert.match(globalCssSource, /\.automation-edit-form \{/);
});

test("automation edit form exposes reasoning, fast, and other model options", () => {
  assert.match(automationsSource, /ModelPicker/);
  assert.match(automationsSource, /ModelOptionsMenu/);
  assert.match(automationsSource, /data-slot="automation-model-options"/);
  assert.match(automationsSource, /modelParams: draft.modelParams/);
  assert.match(automationsSource, /Use a standard model/);
  assert.match(automationsSource, /Subagent model/);
  assert.match(automationsSource, /extendedModelParams: draft.extendedModelParams/);
  assert.match(automationsSource, /extendedModelOptionsLabel/);
  assert.match(automationsSource, /favoriteModelKeys=\{favoriteModelKeys\}/);
  assert.match(globalCssSource, /\.automation-model-picker \{/);
  assert.match(globalCssSource, /\.automation-subagent-model \{/);
  assert.match(shellSource, /onToggleFavoriteModel=\{toggleFavoriteModel\}/);
});

test("mobile chat actions are touch-sized, edit is reachable, and run status stays with the transcript", () => {
  assert.match(shellSource, /onClick=\{\(\) => startEditing\(m\)\}/);
  assert.match(shellSource, /function startEditing\(message: Msg\)[\s\S]*message\.role !== "user"/);
  assert.doesNotMatch(shellSource, /startEditing[\s\S]{0,240}message\.id\.startsWith\("u-"\)/);
  assert.match(shellSource, /h-9 gap-1 rounded-lg px-2/);
  assert.match(shellSource, /className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground md:hidden"/);
  assert.match(shellSource, /className="mb-2 hidden items-center justify-center gap-2 text-xs text-muted-foreground md:flex"/);
  assert.match(shellSource, /env\(safe-area-inset-bottom\)/);
});

test("mobile composer uses a centered header model picker and progressive secondary controls", () => {
  assert.match(shellSource, /open=\{mobileModelMenuOpen\}/);
  assert.match(shellSource, /w-\[min\(38vw,18rem\)\][\s\S]*aria-label=\{`Model:/);
  assert.match(shellSource, /className="flex flex-col gap-1"/);
  assert.match(shellSource, /aria-label=\{`Agent mode:[\s\S]*h-7 min-w-0 max-w-\[11rem\]/);
  assert.match(shellSource, /aria-label=\{`Runtime permissions:[\s\S]*className="hidden size-7[\s\S]*md:flex/);
  assert.match(shellSource, /className="hidden h-7[\s\S]*md:inline-flex"[\s\S]*title=\{`Model:/);
  assert.match(shellSource, /mobileComposerControls=\{\{\s*modes,/);
  assert.doesNotMatch(shellSource, /mobileComposerControls=\{\{[\s\S]{0,120}modes: \[\]/);
  assert.match(shellSource, /<span className="shrink-0">Context<\/span>[\s\S]*md:hidden/);
  assert.match(shellSource, /PlanUsageGauge[\s\S]*className="hidden h-7 px-1 text-\[10px\] md:inline-flex"/);
  assert.match(shellSource, /className="size-11 shrink-0 self-end rounded-full sm:size-9"/);
  assert.match(shellSource, /justify-center pb-\[10svh\]/);
  assert.match(shellSource, /text-center text-\[28px\] font-semibold/);
});


test("model selector remembers the last model per provider account and keeps search collapsed on desktop and mobile", () => {
  assert.match(shellSource, /const \[lastModelByProvider, setLastModelByProvider\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(shellSource, /lastModelByProvider: nextLastModelByProvider/);
  assert.match(shellSource, /const rememberedModelId = lastModelByProvider\[provider\.value\]/);
  assert.match(shellSource, /void selectModel\(rememberedModelId\)/);
  assert.match(shellSource, /modelMatchesAccount\(\{ id: rememberedModelId \}, provider\.value\)/);
  assert.match(shellSource, /models\.some\(\(model\) => model\.id === rememberedModelId\)/);
  assert.equal(
    shellSource.match(/setModelSearchOpen\(false\);\s*setModelProviderFilter\(modelAccountKey\(\{ id: modelId \}\)\)/g)?.length,
    2,
    "desktop and mobile menus must start with collapsed search and the selected account",
  );
  assert.match(shellSource, /if \(modelSearchOpen\) modelSearchRef\.current\?\.focus\(\)/);
  assert.match(shellSource, /modelSearchOpen \? \([\s\S]*aria-label="Search models"[\s\S]*Search models/);
});

test("provider usage is text-only instead of a decorative gauge icon", () => {
  assert.match(quotaSource, /left !== null \? `\$\{left\.toFixed\(0\)\}%` : "—"/);
  assert.match(quotaSource, /text-muted-foreground\/60/);
  assert.doesNotMatch(quotaSource, /SemicircleGauge|UsageRing/);
  assert.doesNotMatch(quotaSource, /hover:bg-muted\/25/);
});


test("workspace does not show a loading skeleton for a fresh draft with no chat id", () => {
  assert.match(shellSource, /loadingChatId !== null && loadingChatId === activeChatId/);
});
