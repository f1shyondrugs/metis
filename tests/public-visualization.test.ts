import assert from "node:assert/strict";
import test from "node:test";
import { compileGraphExpression, parseGraphDocument } from "../lib/graph-spec";
import { parseChartDocument } from "../lib/chart-spec";
import { PUBLIC_GRAPH_TEXT, publicChartDocument, publicGraphDocument, publicVisualizationColor } from "../lib/public-visualization";

const numeric = (source: string, names: string[] = []) => compileGraphExpression(source, names, { numericOnly: true });

test("public graph expressions retain supported arithmetic, constants, sliders and math", () => {
  assert.equal(numeric("a*sin(x) + sqrt(4)^2 - .5", ["a"])({ x: Math.PI / 2, a: 2 }), 5.5);
  assert.equal(numeric("2^3^2")({}), 512);
  assert.equal(numeric("-2^2")({}), -4);
  assert.equal(numeric("2^-2")({}), .25);
  assert.equal(numeric("1e3 + 5E-1")({}), 1000.5);
  assert.equal(numeric("max(1, min(3, 5)) + abs(-2) + floor(pi)")({}), 8);
  assert.equal(numeric("round(ln(e)) + pow(2,3) + 7%4")({}), 12);
  assert.equal(numeric("a_1*x", ["a_1"])({ x: 3, a_1: 2 }), 6);
  assert.ok(Number.isNaN(numeric("1/0")({})));
  assert.ok(Number.isNaN(numeric("constructor", ["constructor"])({ x: 0 })));
  assert.ok(Number.isNaN(numeric("a", ["a"])({ x: 0, a: "1" as unknown as number })));
});

test("public expressions cannot call globals, inspect prototypes or execute JavaScript syntax", () => {
  let calls = 0;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__publicGraphSentinel = () => { calls += 1; return 1; };
  try {
    for (const source of [
      "__publicGraphSentinel()", "sin.__proto__.__defineGetter__(max,min)",
      "sin.constructor()", "x.__proto__", "x[0]", "fetch('/api/private')", "new Image()",
      "globalThis.fetch(x)", "(() => 1)()", "x=1", "1;2", "1/*comment*/+2",
      "1//comment\n+2", "{x:1}", "sin.__lookupGetter__(x)",
    ]) assert.throws(() => numeric(source, ["__publicGraphSentinel"]), /graph expression/, source);
    assert.equal(calls, 0);
  } finally { delete globals.__publicGraphSentinel; }
});

test("public paint accepts literal colors and discards resource CSS", () => {
  for (const color of ["#fff", "#1234", "#112233", "#11223344", "red", "rebeccapurple", "rgb(10 20 30 / .5)", "hsl(120,50%,50%)"]) {
    assert.equal(publicVisualizationColor(color), color);
  }
  for (const color of ["url(/api/private)", "url(https://example.org/private.svg)", "var(--private)", "red;fill:url(/api/private)", "u\\72l(/api/private)", "image-set('/api/private')"]) {
    assert.equal(publicVisualizationColor(color), undefined, color);
  }
});

test("public graph and chart projections drop resource colors without mutating editable documents", () => {
  const graph = parseGraphDocument(JSON.stringify({ elements: [
    { type: "point", name: '<img src="/api/private">', x: 0, y: 0, color: "url(/api/private)" },
    { type: "function", fn: "x^2", color: "#123456" },
    { type: "line", from: "A", to: "B", color: "url(/api/private)" },
    { type: "circle", center: "A", radius: "a", color: "var(--private)" },
    { type: "text", x: 0, y: 0, text: '<img src="/api/private" onerror="bad()">' },
  ] }));
  const safeGraph = publicGraphDocument(graph);
  assert.equal("color" in safeGraph.boards[0].elements[0] ? safeGraph.boards[0].elements[0].color : null, undefined);
  assert.equal("color" in safeGraph.boards[0].elements[1] ? safeGraph.boards[0].elements[1].color : null, "#123456");
  assert.equal("color" in graph.boards[0].elements[0] ? graph.boards[0].elements[0].color : null, "url(/api/private)");
  const chart = parseChartDocument(JSON.stringify({ type: "bar", labels: ["A"], series: [
    { name: "Unsafe", color: "url(/api/private)", values: [1] }, { name: "Safe", color: "blue", values: [2] },
  ] }));
  const safeChart = publicChartDocument(chart);
  assert.equal(safeChart.charts[0].series?.[0].color, undefined);
  assert.equal(safeChart.charts[0].series?.[1].color, "blue");
  assert.equal(chart.charts[0].series?.[0].color, "url(/api/private)");
  assert.equal(PUBLIC_GRAPH_TEXT.display, "internal");
  assert.equal(PUBLIC_GRAPH_TEXT.parse, false);
});
