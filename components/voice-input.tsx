"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mic, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceTranscriptPreview } from "@/components/voice-transcript-preview";
import { openSelectedMicrophone } from "@/lib/local-microphone";
import { transcribeRecording } from "@/lib/voice-upload";
import { connectRealtimeVoice, type RealtimeVoiceSession } from "@/lib/voice-realtime";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

let cancelActiveVoice: (() => void) | null = null;

type VoiceInputProps = {
  variant?: "composer" | "field";
  onStart?: () => void;
  chatId?: string | null;
  onTranscript: (text: string) => void | ((finalText: string) => void);
  onPreviewChange?: (text: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  onStateChange?: (state: VoiceState) => void;
  onWaveformLevelChange?: (level: number) => void;
  enabled?: boolean;
  maxDurationSeconds?: number;
  provider?: "openai" | "local" | "custom" | "browser";
  modelId?: string;
  realtime?: boolean;
  endpoint?: string;
  connectionId?: string;
  /** External recording control. Undefined leaves the ordinary button behavior. */
  captureRequested?: boolean;
  stopSignal?: number;
  cancelSignal?: number;
  onOpenSettings?: () => void;
};

export type VoiceState = "idle" | "permission" | "recording" | "uploading" | "transcribing" | "ready" | "error";
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function VoiceInput({
  variant = "composer", onStart,
  chatId,
  onTranscript,
  onPreviewChange,
  onRecordingChange,
  onStateChange,
  onWaveformLevelChange,
  enabled = true,
  maxDurationSeconds,
  provider = "openai",
  modelId = "whisper-1",
  realtime = false,
  endpoint,
  connectionId,
  captureRequested,
  stopSignal = 0,
  cancelSignal = 0,
  onOpenSettings,
}: VoiceInputProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [maxDuration, setMaxDuration] = useState(300);
  const [lastRecording, setLastRecording] = useState<{ blob: Blob; duration: number } | null>(null);
  const [level, setLevel] = useState(0);
  const [livePreview, setLivePreview] = useState("");
  const captureEpoch = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformPeakRef = useRef(0.12);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const livePreviewRef = useRef("");
  const discardingRef = useRef(false);
  const realtimeSessionRef = useRef<RealtimeVoiceSession | null>(null);
  const realtimeStartRef = useRef<AbortController | null>(null);
  const pendingRealtimeRef = useRef<{
    session: RealtimeVoiceSession; controller: AbortController;
    inserted: boolean; finalize?: (text: string) => void;
  } | null>(null);
  const transcriptCallbackRef = useRef(onTranscript);
  transcriptCallbackRef.current = onTranscript;
  const startedAtRef = useRef(0);
  const lastStopSignalRef = useRef(stopSignal);
  const lastCancelSignalRef = useRef(cancelSignal);
  const setRecording = useCallback((recording: boolean) => {
    onRecordingChange?.(recording);
  }, [onRecordingChange]);
  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);
  useEffect(() => { onPreviewChange?.(livePreview); }, [livePreview, onPreviewChange]);
  const commitTranscript = useCallback((text: string) => {
    const transcript = text.trim();
    const finalize = transcript ? transcriptCallbackRef.current(transcript) : undefined;
    setLivePreview("");
    livePreviewRef.current = "";
    setLevel(0);
    onWaveformLevelChange?.(0);
    setRecording(false);
    setState("idle");
    return finalize;
  }, [onWaveformLevelChange, setRecording]);
  useEffect(() => {
    if (typeof maxDurationSeconds === "number") {
      setMaxDuration(Math.max(1, Math.min(3600, Math.floor(maxDurationSeconds))));
      return;
    }
    void fetch("/api/preferences", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const value = body.settings?.voiceInput?.maxDurationSeconds;
        if (typeof value === "number" && Number.isFinite(value)) setMaxDuration(Math.max(1, Math.min(3600, Math.floor(value))));
      })
      .catch(() => undefined);
  }, [maxDurationSeconds]);

  const cleanupCapture = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);
  const cleanup = useCallback(() => {
    realtimeStartRef.current?.abort();
    realtimeStartRef.current = null;
    realtimeSessionRef.current?.close();
    realtimeSessionRef.current = null;
    pendingRealtimeRef.current?.controller.abort();
    pendingRealtimeRef.current?.session.close();
    pendingRealtimeRef.current = null;
    cleanupCapture();
  }, [cleanupCapture]);

  const startVisualizer = useCallback((stream: MediaStream) => {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    waveformPeakRef.current = 0.12;
    const data = new Uint8Array(analyser.fftSize);
    const animate = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rawLevel = Math.sqrt(sum / data.length) * 9;
      const gatedLevel = Math.max(0, rawLevel - 0.06);
      waveformPeakRef.current = Math.max(gatedLevel, waveformPeakRef.current * 0.997);
      const nextLevel = gatedLevel === 0
        ? 0
        : Math.min(1, gatedLevel / Math.max(0.1, waveformPeakRef.current * 0.55));
      setLevel(nextLevel);
      onWaveformLevelChange?.(nextLevel);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
  }, [onWaveformLevelChange]);

  const stop = useCallback(() => {
    const session = realtimeSessionRef.current;
    if (session && realtimeStartRef.current) {
      const pending = {
        session, controller: realtimeStartRef.current,
        inserted: false, finalize: undefined as ((text: string) => void) | undefined,
      };
      pendingRealtimeRef.current = pending;
      realtimeSessionRef.current = null;
      realtimeStartRef.current = null;
      const finalText = session.finish();
      cleanupCapture();
      const preview = livePreviewRef.current.trim();
      if (preview) {
        pending.inserted = true;
        pending.finalize = commitTranscript(preview) || undefined;
      } else {
        setState("transcribing");
        setRecording(false);
      }
      void finalText.then((text) => {
        if (pendingRealtimeRef.current !== pending) return;
        pendingRealtimeRef.current = null;
        if (pending.inserted) pending.finalize?.(text);
        else if (text) commitTranscript(text);
        else {
          setState("error");
          setError("No speech was detected.");
        }
      }).catch((cause) => {
        if (pendingRealtimeRef.current !== pending) return;
        pendingRealtimeRef.current = null;
        // Preserve the usable streamed draft if finalization fails.
        if (pending.inserted) return;
        setState("error");
        setError(cause instanceof Error ? cause.message : "Realtime transcription failed.");
      });
      return;
    }
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setRecording(false);
    recorder.stop();
  }, [cleanupCapture, commitTranscript, setRecording]);

  useEffect(() => {
    if (lastStopSignalRef.current === stopSignal) return;
    lastStopSignalRef.current = stopSignal;
    if (state === "recording") stop();
  }, [state, stop, stopSignal]);

  useEffect(() => {
    if (state !== "recording") return;
    const updateElapsed = () => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1_000);
      setElapsed(seconds);
      if (seconds >= maxDuration) stop();
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [state, maxDuration, stop]);

  const transcribe = useCallback(async (blob: Blob, duration: number) => {
    const epoch = captureEpoch.current;
    setState("uploading");
    setError("");
    const form = new FormData();
    form.append("durationSeconds", String(duration));
    if (chatId) form.append("chatId", chatId);
    form.append("provider", provider);
    form.append("modelId", modelId);
    form.append("realtime", String(realtime));
    if (endpoint) form.append("endpoint", endpoint);
    if (connectionId) form.append("connectionId", connectionId);
    try {
      const transcript = await transcribeRecording(blob, form, () => setState("transcribing"));
      if (captureEpoch.current === epoch) commitTranscript(transcript);
    } catch (cause) {
      if (captureEpoch.current !== epoch) return;
      setState("error");
      setError(cause instanceof Error ? cause.message : "Transcription failed.");
      setRecording(false);
    }
  }, [chatId, connectionId, endpoint, modelId, commitTranscript, provider, realtime, setRecording]);

  const start = async () => {
    if (!enabled) return;
    if (cancelActiveVoice && cancelActiveVoice !== discard) cancelActiveVoice();
    cancelActiveVoice = discard;
    const epoch = ++captureEpoch.current;
    discardingRef.current = false;
    onStart?.();
    pendingRealtimeRef.current?.controller.abort();
    pendingRealtimeRef.current?.session.close();
    pendingRealtimeRef.current = null;
    if (provider === "browser") {
      setState("permission");
      const speechWindow = window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      };
      const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setState("error");
        setError("Browser transcription is not supported in this browser.");
        return;
      }
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (captureEpoch.current !== epoch) { stream.getTracks().forEach(track => track.stop()); return; }
          streamRef.current = stream;
          startVisualizer(stream);
        } catch {
          // SpeechRecognition can still provide a transcript without the visualizer stream.
        }
      }
      if (captureEpoch.current !== epoch) return;
      const recognition = new SpeechRecognition();
      speechRecognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        if (captureEpoch.current !== epoch) return;
        let text = "";
        for (let index = 0; index < event.results.length; index += 1) text += `${event.results[index][0].transcript} `;
        livePreviewRef.current = text.trim();
        setLivePreview(livePreviewRef.current);
      };
      recognition.onerror = (event) => {
        if (captureEpoch.current !== epoch) return;
        speechRecognitionRef.current = null;
        cleanup();
        if (discardingRef.current) {
          discardingRef.current = false;
          return;
        }
        setState("error");
        setError(event.error || "Browser transcription failed.");
        setRecording(false);
      };
      recognition.onend = () => {
        if (captureEpoch.current !== epoch) return;
        speechRecognitionRef.current = null;
        cleanup();
        if (discardingRef.current) {
          discardingRef.current = false;
          return;
        }
        if (livePreviewRef.current) commitTranscript(livePreviewRef.current);
        else {
          setState("error");
          setError("No speech was detected.");
          setRecording(false);
        }
      };
      setLivePreview("");
      livePreviewRef.current = "";
      setElapsed(0);
      startedAtRef.current = Date.now();
      setState("recording");
      setRecording(true);
      recognition.start();
      return;
    }
    if (provider === "openai" && realtime) {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        setState("error");
        setError("Realtime voice is not supported in this browser.");
        return;
      }
      setState("permission");
      setError("");
      setLastRecording(null);
      setLivePreview("");
      livePreviewRef.current = "";
      const controller = new AbortController();
      realtimeStartRef.current = controller;
      try {
        const stream = await openSelectedMicrophone();
        if (controller.signal.aborted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        startVisualizer(stream);
        const session = await connectRealtimeVoice({
          stream, modelId, connectionId, signal: controller.signal,
          onPreview: (text) => {
            const pending = pendingRealtimeRef.current;
            if (pending?.controller === controller) {
              if (!pending.inserted && text.trim()) {
                pending.inserted = true;
                pending.finalize = commitTranscript(text) || undefined;
              }
              return;
            }
            if (realtimeStartRef.current !== controller) return;
            livePreviewRef.current = text;
            setLivePreview(text);
          },
          onError: (cause) => {
            if (realtimeStartRef.current !== controller) return;
            cleanup();
            setRecording(false);
            setLevel(0);
            onWaveformLevelChange?.(0);
            setState("error");
            setError(cause.message);
          },
        });
        if (controller.signal.aborted) { session.close(); return; }
        realtimeSessionRef.current = session;
        startedAtRef.current = Date.now();
        setElapsed(0);
        setState("recording");
        setRecording(true);
      } catch (cause) {
        if (realtimeStartRef.current !== controller) return;
        cleanup();
        setRecording(false);
        setState("error");
        setError(cause instanceof Error ? cause.message : "Realtime voice failed.");
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("This browser does not support microphone recording.");
      return;
    }
    setState("permission");
    setError("");
    try {
      const stream = await openSelectedMicrophone();
      if (captureEpoch.current !== epoch) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (captureEpoch.current !== epoch) return;
        if (discardingRef.current) {
          discardingRef.current = false;
          cleanup();
          return;
        }
        const duration = Math.max(1, Math.min(maxDuration, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        cleanup();
        setLastRecording({ blob, duration });
        void transcribe(blob, duration);
      };
      startVisualizer(stream);
      recorder.start(250);
      setState("recording");
      setRecording(true);
    } catch (cause) {
      if (captureEpoch.current !== epoch) return;
      cleanup();
      setState("error");
      setError(cause instanceof Error ? cause.message : "Microphone permission was denied.");
    }
  };

  const discard = useCallback(() => {
    captureEpoch.current++;
    if (cancelActiveVoice === discard) cancelActiveVoice = null;
    const hasSpeechRecognition = Boolean(speechRecognitionRef.current);
    const hasRecorder = recorderRef.current?.state === "recording";
    discardingRef.current = hasSpeechRecognition || hasRecorder;
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    if (hasRecorder) recorderRef.current?.stop();
    cleanup();
    setLastRecording(null);
    setElapsed(0);
    setLevel(0);
    onWaveformLevelChange?.(0);
    setLivePreview("");
    livePreviewRef.current = "";
    setError("");
    setState("idle");
    setRecording(false);
    if (!hasSpeechRecognition && !hasRecorder) discardingRef.current = false;
  }, [cleanup, onWaveformLevelChange, setRecording]);

  useEffect(() => {
    if (enabled) return;
    discard();
  }, [discard, enabled]);

  useEffect(() => {
    if (lastCancelSignalRef.current === cancelSignal) return;
    lastCancelSignalRef.current = cancelSignal;
    discard();
  }, [cancelSignal, discard]);

  useEffect(() => () => {
    captureEpoch.current++;
    if (cancelActiveVoice === discard) cancelActiveVoice = null;
    discardingRef.current = true;
    speechRecognitionRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    cleanup();
    setRecording(false);
    onStateChange?.("idle");
    onWaveformLevelChange?.(0);
    onPreviewChange?.("");
  }, [cleanup, discard, onStateChange, onWaveformLevelChange, onPreviewChange, setRecording]);

  const startCaptureRef = useRef(start);
  startCaptureRef.current = start;
  const externalCaptureRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (captureRequested === undefined || captureRequested === externalCaptureRef.current) return;
    externalCaptureRef.current = captureRequested;
    if (captureRequested) { if (enabled && (state === "idle" || state === "error")) void startCaptureRef.current(); }
    else if (state === "recording") stop();
    else if (state === "permission") discard();
  }, [captureRequested, enabled, state, stop, discard]);

  if (!enabled) return null;

  const voiceConfigured = provider === "browser" || Boolean(connectionId);

  if (variant === "field") {
    const recording = state === "recording";
    const busy = ["permission", "uploading", "transcribing"].includes(state);
    const liveTranscription = provider === "browser" || (provider === "openai" && realtime);
    return <Popover open={Boolean(livePreview || state === "error" || recording || busy)}>
      <PopoverAnchor asChild><div className="relative flex items-center gap-0.5" data-field-dictation="">
      <Button type="button" size="icon-action" variant="ghost"
        className="size-11 shrink-0 text-muted-foreground sm:size-9 pointer-coarse:size-11" disabled={busy || (!voiceConfigured && !onOpenSettings)}
        aria-label={recording ? "Stop recording" : busy ? "Transcribing voice input" : "Record voice input"}
        title={voiceConfigured ? "Voice input" : "Set up voice input"}
        onPointerDown={event => event.preventDefault()}
        onClick={() => recording ? stop() : voiceConfigured ? void start() : onOpenSettings?.()}>
        {recording ? <Square className="size-4 text-destructive" /> : busy ? <LoaderCircle className="size-4 animate-spin" /> : <Mic className="size-4" />}
      </Button>
      </div></PopoverAnchor>
      {livePreview || state === "error" || recording || busy ? <PopoverContent align="end" side="bottom" collisionPadding={8} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} role={state === "error" ? "alert" : "dialog"} aria-label="Voice input"
        className="w-72 max-w-[calc(100vw-1rem)] p-3 text-sm">
        {state === "error" ? error : <>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{recording ? "Recording" : state === "permission" ? "Starting microphone…" : "Transcribing…"}</span>
            <div className="flex shrink-0 items-center gap-2">
              {recording ? <span className="text-xs tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span> : null}
              {recording || busy ? <Button type="button" size="xs" variant="ghost" className="h-9 px-2 sm:h-7 pointer-coarse:min-h-11" aria-label="Cancel voice input" onClick={discard}>Cancel</Button> : null}
            </div>
          </div>
          {liveTranscription && (recording || livePreview) ? <VoiceTranscriptPreview text={livePreview || "Listening…"} className="px-0 py-2" />
            : recording ? <div role="img" aria-label="Audio waveform" className="mt-2 flex h-10 items-center justify-between gap-1 overflow-hidden">
              {Array.from({ length: 36 }, (_, index) => <span key={index} className="w-1 shrink-0 rounded-full bg-primary/65 motion-safe:transition-[height]" style={{ height: `${Math.max(2, 2 + level * (8 + (0.35 + Math.abs(Math.sin(index * 1.73)) * 0.65) * 14))}px` }} />)}
            </div> : null}
        </>}
        {state === "error" ? <div className="mt-1 flex justify-end gap-1">
          {lastRecording ? <Button type="button" size="xs" variant="ghost" onClick={() => void transcribe(lastRecording.blob, lastRecording.duration)}>Retry</Button> : null}
          <Button type="button" size="xs" variant="ghost" onClick={discard}>Dismiss</Button>
        </div> : null}
      </PopoverContent> : null}
    </Popover>;
  }

  return (
    <div className="flex items-center gap-1">
      {state !== "recording" ? (
        voiceConfigured ? (
          <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0 rounded-full sm:size-9" onClick={() => void start()} disabled={["permission", "uploading", "transcribing"].includes(state)} aria-label="Record voice input" title="Record voice input">
            <Mic className="size-4" />
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex" tabIndex={0}>
                <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0 rounded-full text-muted-foreground/50 sm:size-9" disabled aria-label="Voice input requires an API key">
                  <Mic className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 flex-col items-start">
              <span>Set up your Voice API key before using the voice feature.</span>
              <button type="button" className="font-medium text-primary-foreground underline underline-offset-2" onClick={onOpenSettings}>
                Open voice settings
              </button>
            </TooltipContent>
          </Tooltip>
        )
      ) : null}
      {state === "recording" ? <span className="mr-2 text-[10px] tabular-nums text-red-400">{formatDuration(elapsed)}</span> : null}
      {!onPreviewChange && (provider === "browser" || (provider === "openai" && realtime)) && livePreview ? <span className="max-w-48 truncate text-[11px] italic text-muted-foreground" title={livePreview}>{livePreview}</span> : null}
      {state === "ready" ? (
        <>
          <Button type="button" size="icon-xs" variant="secondary" onClick={() => {
            if (provider === "browser" || (provider === "openai" && realtime)) {
              commitTranscript(livePreview);
            } else if (lastRecording) {
              void transcribe(lastRecording.blob, lastRecording.duration);
            }
          }} aria-label="Confirm voice input" title="Confirm voice input">
            <Check className="size-3.5" />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={discard} aria-label="Discard voice input" title="Discard voice input">
            <X className="size-3.5" />
          </Button>
        </>
      ) : null}
      {state === "ready" ? <span className="text-[10px] text-emerald-500">Draft inserted</span> : null}
      {state === "error" ? (
        <>
          <span className="max-w-40 truncate text-[10px] text-destructive" title={error}>{error}</span>
          {lastRecording ? <Button type="button" size="icon-xs" variant="ghost" onClick={() => void transcribe(lastRecording.blob, lastRecording.duration)} aria-label="Retry transcription"><RotateCcw className="size-3.5" /></Button> : null}
          <Button type="button" size="icon-xs" variant="ghost" onClick={discard} aria-label="Discard recording"><X className="size-3.5" /></Button>
        </>
      ) : null}
    </div>
  );
}
