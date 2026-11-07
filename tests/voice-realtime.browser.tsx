/** Isolated browser regression: real voice/composer components, simulated microphone and provider. */
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceInput, type VoiceState } from "../components/voice-input";
import { VoiceTranscriptPreview } from "../components/voice-transcript-preview";
import { RichComposerInput } from "../components/rich-composer-input";
import { composerTranscriptInsert, composerTranscriptFinalizer } from "../lib/composer-send";

const host = document.createElement("main");
const report = document.createElement("pre");
document.body.append(host, report);
host.style.cssText = "max-width:760px;margin:32px auto;padding:16px";
report.style.cssText = "white-space:pre-wrap;font-size:12px;padding:16px";
const root = createRoot(host);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const results: string[] = [];
let state: VoiceState = "idle";
let stoppedTracks = 0;
let holdSecret = false;
let releaseSecret: (() => void) | undefined;
let currentTrack = { enabled: true, stop() { stoppedTracks++; } };
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
  currentTrack = { enabled: true, stop() { stoppedTracks++; } };
  const track = currentTrack;
  return { getTracks: () => [track], getAudioTracks: () => [track] };
} } });
Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (String(input) === "/api/voice/realtime") {
    if (holdSecret) await new Promise<void>(resolve => { releaseSecret = resolve; });
    init?.signal?.throwIfAborted();
    return Response.json({ value: "ek-fixture" });
  }
  if (String(input) === "https://api.openai.com/v1/realtime/calls") return new Response("fixture-answer");
  throw new Error("Unexpected fixture request");
};
class Channel {
  readyState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent = 0;
  close() { this.readyState = "closed"; this.onclose?.(); }
  send() { this.sent++; }
  receive(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
class Peer {
  static last: Peer;
  channel = new Channel();
  connectionState = "connected";
  closed = false;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { Peer.last = this; }
  createDataChannel() { return this.channel; }
  addTrack() {}
  async createOffer() { return { type: "offer", sdp: "fixture-offer" }; }
  async setLocalDescription() {}
  async setRemoteDescription() { this.channel.readyState = "open"; this.channel.onopen?.(); }
  close() { this.closed = true; }
}
window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
const onRecording = () => {};
const onWaveform = () => {};

function Harness() {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [preview, setPreview] = useState("");
  const [draft, setDraft] = useState("Existing draft.");
  const [nonce, setNonce] = useState(0);
  const [stop, setStop] = useState(0);
  const [cancel, setCancel] = useState(0);
  const snapshot = useRef({ text: draft, chatId: "fixture", epoch: 0, editedAt: "" });
  state = voiceState;
  const apply = (text: string) => {
    snapshot.current = { ...snapshot.current, text, epoch: snapshot.current.epoch + 1 };
    setDraft(text); setNonce(value => value + 1);
  };
  return <section style={{ border: "1px solid var(--border,#555)", borderRadius: 16, padding: 12, background: "var(--background)" }}>
    <p style={{ marginBottom: 12, color: "var(--muted-foreground)" }}>Realtime voice input</p>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
      <button aria-label="Cancel voice input" onClick={() => setCancel(value => value + 1)}>×</button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <RichComposerInput value={draft} syncNonce={nonce} aria-label="Message" placeholder="Message Metis…"
          className={voiceState === "recording" ? "hidden" : ""}
          onChange={text => apply(text)} />
        {voiceState === "recording" ? preview ? <VoiceTranscriptPreview text={preview} /> : <span>Listening…</span> : null}
      </div>
      <VoiceInput provider="openai" modelId="gpt-realtime-whisper" realtime connectionId="fixture"
        maxDurationSeconds={300} stopSignal={stop} cancelSignal={cancel}
        onTranscript={text => {
          const before = snapshot.current.text;
          apply(composerTranscriptInsert(before, text));
          return composerTranscriptFinalizer(before, () => snapshot.current, apply);
        }}
        onPreviewChange={setPreview} onStateChange={setVoiceState}
        onRecordingChange={onRecording} onWaveformLevelChange={onWaveform} />
      <button aria-label={voiceState === "recording" ? "Stop recording" : "Send"}
        disabled={voiceState === "transcribing"} onClick={() => voiceState === "recording" ? setStop(value => value + 1) : apply("")}>
        {voiceState === "recording" ? "■" : "↑"}
      </button>
    </div>
    <button aria-label="Edit draft" onClick={() => apply("Manually edited")}>Edit draft</button>
  </section>;
}
function check(value: unknown, label: string) {
  results.push((value ? "PASS " : "FAIL ") + label);
  report.textContent = results.join("\n");
  if (!value) throw new Error(label);
}
function click(label: string) {
  const button = host.querySelector('[aria-label="' + label + '"]') as HTMLButtonElement;
  if (!button) throw new Error("Missing " + label);
  button.click();
}
const draft = () => (host.querySelector('[aria-label="Message"]') as HTMLTextAreaElement).value;
function delta(peer: Peer, text: string) {
  peer.channel.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: text });
}
function final(peer: Peer, text: string) {
  peer.channel.receive({ type: "input_audio_buffer.committed", item_id: "a", previous_item_id: null });
  peer.channel.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: text });
}
async function record() {
  click("Record voice input");
  for (let i = 0; i < 50 && state !== "recording"; i++) await pause(20);
  check(state === "recording", "recording starts");
  return Peer.last;
}
async function run() {
  root.render(<Harness />); await pause(100);
  let peer = await record();
  delta(peer, "I am speaking"); await pause(40);
  check(host.querySelector('[aria-label="Live transcript"]')?.textContent === "I am speaking", "streamed words are visible before Stop");
  click("Stop recording"); await pause(30);
  check(state === "idle" && draft() === "Existing draft. I am speaking" && !peer.closed, "Stop inserts streamed text immediately while finalization continues");
  check(!(host.querySelector('[aria-label="Send"]') as HTMLButtonElement)?.disabled, "Send stays usable during background finalization");
  check(!host.querySelector('[aria-label="Live transcript"]') && stoppedTracks > 0, "Stop clears the live preview and releases the microphone");
  await pause(300);
  check(peer.channel.sent === 1, "Stop commits the input exactly once");
  final(peer, "I am speaking now."); await pause(50);
  check(draft() === "Existing draft. I am speaking now." && peer.closed, "final text completes the untouched draft without duplication");

  peer = await record(); delta(peer, "second"); await pause(30);
  click("Stop recording"); await pause(30);
  click("Edit draft"); await pause(300);
  final(peer, "second final"); await pause(50);
  check(draft() === "Manually edited", "late final text preserves manual edits");

  peer = await record(); delta(peer, "send now"); await pause(30);
  click("Stop recording"); await pause(30); click("Send"); await pause(300);
  final(peer, "send now final"); await pause(50);
  check(draft() === "", "late final text never resurrects a sent draft");

  peer = await record(); click("Stop recording"); await pause(30);
  check(state === "transcribing", "without streamed words Stop waits for provider data");
  delta(peer, "first available"); await pause(30);
  check(draft() === "first available" && state === "idle", "first available delta unlocks the draft before final completion");
  await pause(300); final(peer, "first available text."); await pause(50);
  check(draft() === "first available text.", "the final tail is preserved");

  peer = await record(); delta(peer, "keep this"); await pause(30);
  click("Stop recording"); await pause(30);
  peer.channel.receive({ type: "error", error: { message: "fixture error" } }); await pause(50);
  check(draft().endsWith("keep this") && state === "idle", "background provider failure retains the usable draft");

  peer = await record(); delta(peer, "discard this"); await pause(30);
  click("Cancel voice input"); await pause(50);
  final(peer, "discarded");
  check(peer.closed && !draft().includes("discard this") && !host.querySelector('[aria-label="Live transcript"]'), "Cancel closes the stream and discards its preview");

  holdSecret = true;
  click("Record voice input"); await pause(50);
  root.unmount(); releaseSecret?.(); await pause(60);
  check(stoppedTracks >= 7, "unmount during connection setup releases the microphone");
  document.body.dataset.complete = "true";
}
async function demo() {
  report.hidden = true;
  root.render(<Harness />); await pause(100);
  const peer = await record();
  (host.querySelector('[aria-label="Edit draft"]') as HTMLElement).hidden = true;
  delta(peer, "Ich kann direkt mitlesen, während ich spreche. Nach Stopp steht der Text sofort im Eingabefeld.");
}
if (location.search.includes("demo")) void demo();
else void run().catch(error => { results.push("FAIL " + String(error)); report.textContent = results.join("\n"); })
  .finally(() => { void realFetch("/report", { method: "POST", body: JSON.stringify({ results, complete: document.body.dataset.complete === "true" }) }); });
