import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { connectRealtimeVoice } from "../lib/voice-realtime";

class Channel {
  readyState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = "closed"; this.onclose?.(); }
  receive(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}
class Peer {
  static last: Peer;
  channel = new Channel();
  connectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  constructor() { Peer.last = this; }
  createDataChannel() { return this.channel; }
  addTrack() {}
  async createOffer() { return { type: "offer", sdp: "test-offer" }; }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.channel.readyState = "open";
    this.channel.onopen?.();
  }
  close() { this.closed = true; this.connectionState = "closed"; this.onconnectionstatechange?.(); }
}

function setup(t: TestContext, responder?: typeof fetch) {
  const oldPeer = globalThis.RTCPeerConnection;
  const oldFetch = globalThis.fetch;
  globalThis.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = responder || (async (input, init) => {
    calls.push({ url: String(input), init });
    return String(input) === "/api/voice/realtime"
      ? Response.json({ value: "ek-fixture", session: { type: "transcription" } })
      : new Response("test-answer");
  });
  t.after(() => { globalThis.RTCPeerConnection = oldPeer; globalThis.fetch = oldFetch; });
  const track = { enabled: true };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const controller = new AbortController();
  const previews: string[] = [];
  const errors: Error[] = [];
  const options = {
    stream, modelId: "gpt-realtime-whisper", connectionId: "selected-account", signal: controller.signal,
    onPreview: (text: string) => previews.push(text), onError: (error: Error) => errors.push(error),
  };
  return { calls, track, controller, previews, errors, options };
}

test("GA secret and transcription session connect; Stop waits for committed final text", async (t) => {
  const f = setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = await connectRealtimeVoice(f.options);
  t.after(() => session.close());
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), {
    modelId: "gpt-realtime-whisper", connectionId: "selected-account",
  });
  assert.equal(f.calls[1].url, "https://api.openai.com/v1/realtime/calls");
  assert.equal((f.calls[1].init?.headers as Record<string, string>).Authorization, "Bearer ek-fixture");
  const peer = Peer.last;
  peer.channel.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "Hallo Wel" });
  const final = session.finish();
  assert.equal(session.finish(), final);
  assert.equal(f.track.enabled, false);
  assert.equal(peer.closed, false);
  assert.equal(peer.channel.sent.length, 0);
  t.mock.timers.tick(250);
  assert.deepEqual(peer.channel.sent.map(s => JSON.parse(s)), [{ type: "input_audio_buffer.commit" }]);
  peer.channel.receive({ type: "input_audio_buffer.committed", item_id: "a", previous_item_id: null });
  let settled = false;
  void final.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "partial text must not be inserted as the final transcript");
  peer.channel.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "Hallo Welt!" });
  assert.equal(await final, "Hallo Welt!");
  assert.equal(peer.closed, true);
  assert.deepEqual(f.previews, ["Hallo Wel", "Hallo Welt!"]);
  assert.equal(f.errors.length, 0);
});

test("out-of-order items retain earlier turns and completed text replaces deltas", async (t) => {
  const f = setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = await connectRealtimeVoice(f.options);
  t.after(() => session.close());
  const ch = Peer.last.channel;
  ch.receive({ type: "input_audio_buffer.committed", item_id: "b", previous_item_id: "a" });
  ch.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "b", delta: "zwei?" });
  ch.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "eins" });
  const final = session.finish();
  t.mock.timers.tick(250);
  // Completion may arrive before the commit acknowledgment.
  ch.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "zwei" });
  ch.receive({ type: "input_audio_buffer.committed", item_id: "b", previous_item_id: "a" });
  assert.equal(await final, "eins zwei");
});

test("provider errors reject pending finalization and release the peer", async (t) => {
  const f = setup(t);
  const session = await connectRealtimeVoice(f.options);
  const final = session.finish();
  const rejection = assert.rejects(final, /insufficient quota/);
  Peer.last.channel.receive({ type: "error", error: { message: "insufficient quota" } });
  await rejection;
  assert.equal(Peer.last.closed, true);
  assert.equal(f.errors[0].message, "insufficient quota");
});

test("cancel discards pending text and ignores late events", async (t) => {
  const f = setup(t);
  const session = await connectRealtimeVoice(f.options);
  const final = session.finish();
  const rejection = assert.rejects(final, { name: "AbortError" });
  f.controller.abort();
  await rejection;
  Peer.last.channel.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "discarded" });
  assert.deepEqual(f.previews, []);
  assert.deepEqual(f.errors, []);
  assert.equal(Peer.last.closed, true);
});

test("missing final completion times out instead of silently truncating text", async (t) => {
  const f = setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = await connectRealtimeVoice(f.options);
  const final = session.finish();
  const rejection = assert.rejects(final, /waiting for the final text/);
  t.mock.timers.tick(30_000);
  await rejection;
  assert.equal(Peer.last.closed, true);
});

test("cancel during negotiation closes the peer without reporting a recording error", async (t) => {
  const f = setup(t);
  Peer.prototype.setRemoteDescription = async function () { f.controller.abort(); };
  t.after(() => {
    Peer.prototype.setRemoteDescription = async function () {
      this.channel.readyState = "open"; this.channel.onopen?.();
    };
  });
  await assert.rejects(connectRealtimeVoice(f.options), { name: "AbortError" });
  assert.equal(Peer.last.closed, true);
  assert.deepEqual(f.errors, []);
});

test("session creation and SDP errors preserve the actionable provider message", async (t) => {
  const f = setup(t, async () => Response.json({ error: "API key rejected" }, { status: 401 }));
  await assert.rejects(connectRealtimeVoice(f.options), /API key rejected/);
  globalThis.fetch = async (input) => String(input) === "/api/voice/realtime"
    ? Response.json({ value: "ek-fixture" })
    : Response.json({ error: { message: "Invalid transcription configuration" } }, { status: 400 });
  await assert.rejects(connectRealtimeVoice(f.options), /Invalid transcription configuration/);
  assert.equal(Peer.last.closed, true);
});

test("channel failure releases an established recording", async (t) => {
  const f = setup(t);
  const session = await connectRealtimeVoice(f.options);
  t.after(() => session.close());
  Peer.last.channel.onclose?.();
  assert.equal(Peer.last.closed, true);
  assert.match(f.errors[0].message, /closed before transcription finished/);
});
