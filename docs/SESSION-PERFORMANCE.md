# Long-session resource investigation — 16 November 2026

## Evidence and limits

Read-only owner Windows 1.7.18 inspection found a main renderer with roughly 600 MiB private memory, more than 100 GiB available host RAM, and historical Windows AppHangB1 records in versions 1.7.15 and 1.7.18. No Chrome remote-debugging listener was available. These observations do not establish a V8 leak or an out-of-memory crash. The native render-process-gone handler currently discards Chromium's detailed reason; no reason was recovered for the user's exact renderer failure.

An isolated real React fixture with 24 collapsed tool groups containing 24 tools each mounted 576 hidden tool rows. Twelve paused videos below the viewport all acquired sources and issued media requests. A closed tool popover kept its fetched full payload in component state. These are confirmed retention/resource paths, not proof that they caused every reported Windows hang.

## Scoped corrections

- Collapsed ToolCallGroup mounts no detailed tool/thinking subtrees. Successful inline saved-artifact previews remain outside the disclosure.
- ToolCallChip releases fetched full detail state when its popover closes. Reopening uses the existing authorized endpoint; abort guards reject late results.
- FileEmbed audio/video use ViewportMedia. A 200px intersection margin permits nearby metadata loading; paused far-offscreen media remove src and call load to release browser resources. Time is restored after metadata returns. Explicit playback and focused native controls stay attached; unmount stops only that element. Downloads, original files, public-share URLs and ACLs do not change.

No user cache is cleared, no stored chat history or draft is truncated, no periodic reload, heap-limit increase or forced GC is introduced.

## Reproduction

tests/session-performance.preview.mjs serves synthetic tool details and range-aware synthetic media through the actual fileResponse helper on loopback 3286. Generate the tiny fixture media with FFmpeg (320x180, VP8/WebM, two seconds) under output/session-performance/media.webm. Start with Node22 --import tsx. tests/session-performance.browser.tsx exercises real React components, disclosure cycles, detail reloads and native media lifecycle at 390/768/1440. It reports DOM/source/request counts, not a proof of Windows GPU memory release. Browser-reported heap snapshots are informational only, without controlled GC.

The older tool-call-group suite has three pre-existing saved-card anchor assertions failing on the unchanged parent because cards now use callbacks, not the historical URI anchors. The unrelated old tool-group-live-open max-height source assertion also fails on that parent. Record these separately; do not change product behavior to satisfy stale assertions.

A multi-hour Windows soak and exact user freeze/heap profile remain unverified. No production web restart, owner app restart, native release or install is authorized by this implementation alone.
