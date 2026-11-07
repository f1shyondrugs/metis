import assert from "node:assert/strict";
import test from "node:test";
import { fitMermaidSvg, isMermaidErrorSvg, isMermaidSource, prepareMermaidSource, wrapBareMermaid } from "../lib/mermaid";

test("mermaid fences and flowchart sources are detected", () => {
  assert.equal(isMermaidSource("mermaid", "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource("flowchart", "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource(undefined, "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource("js", "const x = 1"), false);
});

test("bare flowchart blocks are wrapped as mermaid fences", () => {
  const wrapped = wrapBareMermaid("Intro\n\nflowchart TD\n  installer[Installer] --> app[App]\n\nDone");
  assert.match(wrapped, /```mermaid\nflowchart TD\n {2}installer\[Installer\] --> app\[App\]\n```/);
});

test("prepareMermaidSource quotes labels that mermaid would reject", () => {
  const prepared = prepareMermaidSource(
    "flowchart TD\n  compose[docker compose up] -->|ja Default| native[systemd / Windows Task]",
  );
  assert.match(prepared, /compose\["docker compose up"\]/);
  assert.match(prepared, /\|"ja Default"\|/);
  assert.match(prepared, /native\["systemd \/ Windows Task"\]/);
});

test("prepareMermaidSource quotes cylinders, diamonds, and -- edge labels", () => {
  const prepared = prepareMermaidSource(`flowchart TD
 installer[Installer] --> dockerCheck{Docker vorhanden?}
 dockerCheck -->|nein oder --native| native[systemd / Windows Task]
 settings --> db[(users + user_workspace_access)]
 bootstrap[bootstrap-user] --> adminUser[users.is_admin = 1]`);
  assert.match(prepared, /dockerCheck\{"Docker vorhanden\?"\}/);
  assert.match(prepared, /\|"nein oder --native"\|/);
  assert.match(prepared, /db\[\("users \+ user_workspace_access"\)\]/);
  assert.match(prepared, /adminUser\["users.is_admin = 1"\]/);
  assert.doesNotMatch(prepared, /db\["\(users/);
});

test("fitMermaidSvg drops fixed height so diagrams do not sit at the bottom", () => {
  const fitted = fitMermaidSvg(
    '<svg width="800" height="1200" style="max-width:800px;height:1200px" viewBox="0 0 800 1200"></svg>',
  );
  assert.doesNotMatch(fitted, /height="1200"/);
  assert.match(fitted, /max-width:100%;height:auto/);
});

test("fitMermaidSvg preserves node, label and nested SVG dimensions", () => {
  const node = '<rect width="180" height="64" style="stroke-width:2px" />';
  const label = '<foreignObject width="160" height="40"><div>Video workflow</div></foreignObject>';
  const nested = '<svg width="24" height="24" style="width:24px;height:24px"></svg>';
  const fitted = fitMermaidSvg(
    `<svg width="800" height="1200" viewBox="0 0 800 1200" style="max-width:800px;height:1200px;stroke-width:2px">${node}${label}${nested}</svg>`,
  );
  assert.ok(fitted.includes(node));
  assert.ok(fitted.includes(label));
  assert.ok(fitted.includes(nested));
  assert.match(fitted, /viewBox="0 0 800 1200"/);
  assert.match(fitted, /style="stroke-width:2px;width:800px;max-width:100%;height:auto"/);
});

test("fitMermaidSvg adds responsive sizing without changing child-only styles", () => {
  const child = '<rect width="180" height="64" style="width:180px;height:64px" />';
  const fitted = fitMermaidSvg(`<svg width='800' height='1200' viewBox="0 0 800 1200">${child}</svg>`);
  assert.ok(fitted.includes(child));
  assert.match(fitted, /^<svg viewBox="0 0 800 1200" style="width:800px;max-width:100%;height:auto">/);
});

test("isMermaidErrorSvg ignores mermaid CSS and catches the bomb SVG", () => {
  assert.equal(
    isMermaidErrorSvg('<svg class="flowchart"><style>#t1 .error-icon{fill:#a44141;}</style></svg>'),
    false,
  );
  assert.equal(
    isMermaidErrorSvg('<svg><text>Syntax error in text</text><text>mermaid version 11.17.0</text></svg>'),
    true,
  );
});
