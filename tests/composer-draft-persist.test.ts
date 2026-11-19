import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPOSER_DIRTY_MS,
  composerUserEditMeta,
  shouldPersistComposerSession,
} from "../lib/composer-send";

const shellSource = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);

test("composer session persist waits for hydration or a local user edit", () => {
  assert.equal(
    shouldPersistComposerSession({
      chatId: "chat-1",
      persistChatId: null,
    }),
    false,
  );
  assert.equal(
    shouldPersistComposerSession({
      chatId: "chat-1",
      persistChatId: "chat-1",
    }),
    true,
  );
  assert.equal(
    shouldPersistComposerSession({
      chatId: "chat-1",
      persistChatId: "chat-1",
      incognito: true,
    }),
    false,
  );
});

test("composer user edits stamp a dirty window without using Date.now fallback on hydrate", () => {
  const edit = composerUserEditMeta(1_000);
  assert.equal(edit.updatedAt, new Date(1_000).toISOString());
  assert.equal(edit.dirtyUntil, 1_000 + COMPOSER_DIRTY_MS);
});

test("opening a chat does not mark the composer dirty before server hydration", () => {
  assert.match(shellSource, /composerPersistChatRef/);
  assert.match(shellSource, /applySnapshot\(id, cached, "cache"\)/);
  assert.match(shellSource, /composerUserEditMeta\(\)/);
  assert.match(shellSource, /shouldPersistComposerSession\(/);
  assert.doesNotMatch(
    shellSource,
    /composerDirtyUntilRef\.current = Date\.now\(\) \+ 1500/,
  );
  assert.match(
    shellSource,
    /persistActiveSnapshot\(\);[\s\S]*saveNewChatDraft\(stateRef\.current\.input, referencesRef\.current\)/,
  );
});
