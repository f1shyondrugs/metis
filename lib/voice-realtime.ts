// Browser transport for transcription-only Realtime sessions.
// The full API key stays on the server; only a short-lived client secret is used here.
export type RealtimeVoiceSession = {
  finish: () => Promise<string>;
  close: () => void;
};

type Options = {
  stream: MediaStream;
  modelId: string;
  connectionId?: string;
  signal: AbortSignal;
  onPreview: (text: string) => void;
  onError: (error: Error) => void;
};

type Item = { text: string; complete: boolean; previous?: string | null };

export async function connectRealtimeVoice(options: Options): Promise<RealtimeVoiceSession> {
  const { signal, stream } = options;
  signal.throwIfAborted();
  const response = await fetch("/api/voice/realtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: options.modelId, connectionId: options.connectionId }),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  // GA client_secrets returns value at the top level.
  const token = body?.value;
  if (!response.ok || typeof token !== "string" || !token) {
    throw new Error(typeof body?.error === "string" ? body.error : "Could not start realtime voice.");
  }
  signal.throwIfAborted();

  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  const items = new Map<string, Item>();
  let closed = false;
  let connected = false;
  let finishing: Promise<string> | undefined;
  let finishResolve: ((text: string) => void) | undefined;
  let finishReject: ((error: Error) => void) | undefined;
  let committedId: string | undefined;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Negotiation and data-channel events can fail before the SDP request completes.
  void ready.catch(() => undefined);
  const readyTimer = setTimeout(() => fail(new Error("Realtime voice connection timed out.")), 20_000);

  const text = () => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const item = items.get(id)!;
      if (item.previous && items.has(item.previous)) visit(item.previous);
      ordered.push(item.text);
    };
    for (const id of items.keys()) visit(id);
    return ordered.join(" ").trim();
  };

  function close(error: Error = new DOMException("Realtime voice cancelled.", "AbortError")) {
    if (closed) return;
    closed = true;
    clearTimeout(readyTimer);
    clearTimeout(commitTimer);
    clearTimeout(finishTimer);
    signal.removeEventListener("abort", abort);
    channel.onopen = null;
    channel.onmessage = null;
    channel.onerror = null;
    channel.onclose = null;
    peer.onconnectionstatechange = null;
    channel.close();
    peer.close();
    readyReject(error);
    finishReject?.(error);
  }
  function fail(error: Error) {
    if (closed) return;
    close(error);
    if (connected) options.onError(error);
  }
  function abort() { close(); }
  function resolveFinal() {
    if (!committedId || !items.get(committedId)?.complete || !finishResolve) return;
    const result = text();
    const resolve = finishResolve;
    finishResolve = undefined;
    finishReject = undefined;
    close();
    resolve(result);
  }

  signal.addEventListener("abort", abort, { once: true });
  channel.onopen = () => { clearTimeout(readyTimer); readyResolve(); };
  channel.onerror = () => fail(new Error("Realtime voice data connection failed."));
  channel.onclose = () => fail(new Error("Realtime voice connection closed before transcription finished."));
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") {
      fail(new Error("Realtime voice connection failed."));
    }
  };
  channel.onmessage = (event) => {
    if (closed) return;
    let payload: {
      type?: string; item_id?: string; previous_item_id?: string | null;
      delta?: string; transcript?: string; error?: { message?: string };
    };
    try { payload = JSON.parse(event.data); } catch { return; }
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "error" || payload.type === "conversation.item.input_audio_transcription.failed") {
      fail(new Error(payload.error?.message || "Realtime transcription failed."));
      return;
    }
    const id = payload.item_id;
    if (typeof id !== "string") return;
    const item = items.get(id) || { text: "", complete: false };
    if (payload.type === "input_audio_buffer.committed") {
      item.previous = payload.previous_item_id;
      items.set(id, item);
      if (finishing) committedId = id;
      resolveFinal();
    } else if (payload.type === "conversation.item.input_audio_transcription.delta") {
      if (!item.complete && typeof payload.delta === "string") item.text += payload.delta;
      items.set(id, item);
      options.onPreview(text());
    } else if (payload.type === "conversation.item.input_audio_transcription.completed") {
      if (typeof payload.transcript !== "string") return;
      item.text = payload.transcript;
      item.complete = true;
      items.set(id, item);
      options.onPreview(text());
      resolveFinal();
    }
  };

  try {
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    const offer = await peer.createOffer();
    signal.throwIfAborted();
    await peer.setLocalDescription(offer);
    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
      signal,
    });
    if (!sdpResponse.ok) {
      const detail = await sdpResponse.json().catch(() => ({}));
      throw new Error(detail?.error?.message || `Could not connect to realtime voice (HTTP ${sdpResponse.status}).`);
    }
    await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    await ready;
    signal.throwIfAborted();
    if (closed) throw new Error("Realtime voice connection closed.");
    connected = true;
  } catch (error) {
    close();
    throw error;
  }

  return {
    close,
    finish() {
      if (finishing) return finishing;
      if (closed) return Promise.reject(new Error("Realtime voice connection is closed."));
      finishing = new Promise<string>((resolve, reject) => {
        finishResolve = resolve;
        finishReject = reject;
      });
      // Stop microphone input, allow in-flight RTP audio to drain, then commit.
      // Keep the event channel alive until the committed item's final transcript.
      for (const track of stream.getAudioTracks()) track.enabled = false;
      commitTimer = setTimeout(() => {
        if (closed) return;
        try { channel.send(JSON.stringify({ type: "input_audio_buffer.commit" })); }
        catch { fail(new Error("Could not finish realtime transcription.")); }
      }, 250);
      finishTimer = setTimeout(() => fail(new Error("Realtime transcription timed out waiting for the final text.")), 30_000);
      return finishing;
    },
  };
}
