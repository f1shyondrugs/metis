import type { ChartDocument } from "@/lib/chart-spec";
import type { GraphDocument } from "@/lib/graph-spec";

/** Public SVG paint cannot reference URLs, inherited CSS variables or other resources. */
export function publicVisualizationColor(value: string | undefined): string | undefined {
  const color = value?.trim();
  return color && /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|[a-z]{1,32}|(?:rgba?|hsla?|oklab|oklch|lab|lch)\([\d.,% +/e-]+\))$/i.test(color) ? color : undefined;
}

/** JSXGraph otherwise parses text as JessieCode and renders it as HTML. */
export const PUBLIC_GRAPH_TEXT = { display: "internal", parse: false, useMathJax: false, useKatex: false } as const;

export function publicGraphDocument(document: GraphDocument): GraphDocument {
  return { boards: document.boards.map(board => ({ ...board, elements: board.elements.map(element =>
    "color" in element ? { ...element, color: publicVisualizationColor(element.color) } : element,
  ) })) };
}

export function publicChartDocument(document: ChartDocument): ChartDocument {
  return { charts: document.charts.map(chart => ({ ...chart, ...(chart.series ? {
    series: chart.series.map(series => ({ ...series, color: publicVisualizationColor(series.color) })),
  } : {}) })) };
}
