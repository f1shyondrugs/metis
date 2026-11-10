# Dictation in forms and interactive responses

Ask-User prose answers, Custom answers, multiline fields and editable task-list steps use the same voice settings and VoiceInput engine as the composer. Provider, connection, model, realtime mode, selected microphone and duration limit remain account-controlled. Recording begins only after an explicit microphone click. The compact control provides Stop, Cancel, processing and dismissible error states.

FieldDictationContext is provided by the authenticated AppShell. DictationInput and DictationTextarea opt specific prose fields in. Native Input/Textarea components are unchanged: login, settings and third-party website fields do not acquire speech capture implicitly. Disabled/read-only fields, numbers, dates, identities, passwords, payment and token fields are excluded. Public shares have no voice context.

Insertion preserves the existing text and replaces the selected range. Manual edits, external value changes, a disabled/removed target or chat navigation invalidate pending results. An untouched realtime draft can receive its final transcript. Starting another field or the composer cancels the previous capture; late permission grants release their stream.

## Opaque HTML previews

The iframe still has an opaque origin, offline CSP and no microphone permission. It never receives microphone streams, provider credentials or a general API capability.

The optional bridge reports at most 30 visible eligible fields and their rectangles, without values. App-owned microphone controls are rendered outside the iframe. Messages alone cannot start recording. An explicit host click captures the target's local selection; only its transcript is returned through the narrowly scoped begin/commit protocol. The iframe rechecks connectivity, eligibility, value and revision before inserting or finalizing, then emits normal input/change events. Values and revisions remain local to the iframe.

The parent validates contentWindow, opaque origin, document generation, message shape and bounded geometry. Source/theme/chat changes replace the frame generation and cancel its controls. Load/refresh handshakes avoid losing initial field geometry. Streaming previews and public/disabled contexts never enable the bridge.

## Verification

- tests/field-dictation.test.tsx checks insertion limits, field exclusions, actual form rendering and message bounds.
- tests/field-dictation.browser.tsx exercises actual form and opaque-frame components with simulated microphone and speech-provider events. Run it in the Metis in-app browser with the application stylesheet; it does not test microphone hardware or a live provider.
- Existing voice/composer, credential-question and HTML sandbox regressions remain applicable.
