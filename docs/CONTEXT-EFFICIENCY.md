# Provider context efficiency

Codex receives the stable Metis instruction layer through a private, per-invocation
`model_instructions_file`. The native CLI places it in its native instruction
layer instead of appending it as another user message. Each invocation supplies
the current file, including resumed turns, so mode, rule, skill and memory-policy
changes take effect. The file is deleted after success, cancellation or failure.
With native isolation it lives inside the already mounted account home.

Do not substitute `developer_instructions`: the tested CLI restores the original
developer instructions on resume and ignores changes to that setting. The real
CLI regression test uses a local Responses fixture; no provider account or paid
model requests are involved.

`buildProviderPromptParts` separates instructions from current task context.
Explicit project instructions stay in the instruction layer after global custom
rules, preserving their precedence, and are omitted from the task-context copy.
Other adapters retain the combined `buildProviderPrompt` interface. Explicit
references and attachments are resolved and bounded once by that builder; native
current-turn/recovery text does not add another copy.

Project facts are selected with the existing local relevance scorer, capped at
eight whole facts and 12,000 characters. A lexical mismatch uses at most two recent
facts to support vague follow-ups. All project memories remain in durable storage,
and `list_memories` with project scope can retrieve additional facts. Project
instructions, pinned notes, files, permissions and the existing global/chat-memory
policies remain separate. Both Cursor and alternative provider prompts use this
selection. Saved Always-on choices, skill content, model parameters and runtime
limits are unchanged.

The change prevents new repeated policy snapshots. It does not rewrite old native
rollouts: historical copies remain until the provider compacts them naturally.
It also does not reduce the selected context window or change reasoning effort.

## Verification

Run with the installation's configured Node runtime (Node 22 or newer):

```sh
./run-service.sh node_modules/tsx/dist/cli.mjs --test tests/context-efficiency.test.ts tests/codex-instruction-context.test.ts tests/chat-continuity-context.test.ts tests/skill-context.test.ts tests/recovery-transcript.test.ts
```

The native test checks new and resumed requests, replacement of changed policy,
retention of preceding conversation turns, and deletion of previous instruction
files before resume. Synthetic memory tests check bounded selection without
mutating the stored facts, fresh task context, mode changes and Incognito.

On 11 November 2026 a read-only measurement for the requested Metis context task
selected eight of 50 stored project memories: 6,566 characters instead of 52,167
(87% less in that memory block). This measures prompt characters for one task,
not overall token savings, account credits or a provider invoice.

Reference: [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference.md).
