import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_SLASH_COMMANDS, goalCommandAction, matchSlashCommand, slashCommandQuery, slashTrigger, consumeSlashTrigger } from "../lib/slash-commands";

test("built-in slash commands are discoverable at the composer start", () => {
  assert.deepEqual(BUILT_IN_SLASH_COMMANDS.map((command) => command.id), ["model", "goal"]);
  assert.equal(slashCommandQuery("/mo", 3), "mo");
  assert.equal(slashCommandQuery("/goal ", 6), null);
  assert.equal(slashCommandQuery("hello /model", 12), null);
});

test("scoped command triggers preserve the suffix and reject unrelated or stale text", () => {
  assert.deepEqual(slashTrigger("/workspace terminal", 19), { raw: "/workspace terminal", scope: "workspace", query: "terminal" });
  assert.equal(slashTrigger("/access: full", 13)?.query, "full");
  assert.equal(slashTrigger("/model", 3), null);
  assert.equal(slashTrigger("/model", 6, 3), null);
  assert.equal(slashTrigger("/home/metis", 11), null);
  assert.equal(slashTrigger("https://example.test/a", 22), null);
  const input = "/deep-research  A draft with @context";
  const trigger = slashTrigger(input, "/deep-research".length);
  assert(trigger);
  assert.equal(consumeSlashTrigger(input, trigger), "A draft with @context");
  assert.equal(consumeSlashTrigger("/deep-researcher", trigger), null);
  assert.equal(consumeSlashTrigger("a newer draft", trigger), null);
  assert.equal(consumeSlashTrigger(input, null), input);
});

test("slash command parser keeps goal arguments and rejects unknown commands", () => {
  assert.deepEqual(matchSlashCommand("/model"), { id: "model", argument: "" });
  assert.deepEqual(matchSlashCommand("/goal Ship the feature"), { id: "goal", argument: "Ship the feature" });
  assert.deepEqual(matchSlashCommand("/goal line one\nline two"), { id: "goal", argument: "line one\nline two" });
  assert.equal(matchSlashCommand("/unknown text"), null);
  assert.equal(matchSlashCommand("Send /model"), null);
});

test("goal text sends normally while bare goal and reset clear it", () => {
  assert.deepEqual(goalCommandAction("Ship the feature"), { kind: "set", goal: "Ship the feature" });
  assert.deepEqual(goalCommandAction(""), { kind: "reset" });
  assert.deepEqual(goalCommandAction("reset"), { kind: "reset" });
  assert.deepEqual(goalCommandAction("RESET"), { kind: "reset" });
  assert.deepEqual(goalCommandAction("clear"), { kind: "reset" });
  assert.deepEqual(goalCommandAction("reset the layout"), { kind: "set", goal: "reset the layout" });
});
