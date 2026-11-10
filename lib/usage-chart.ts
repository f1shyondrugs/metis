import type { UsageDay } from "./account-types";
import { usageMetricValue, type UsageMetric } from "./usage-model-contributions";
import { usageCostLabel, type UsageCostMode } from "./usage-cost-view";
import { usageTokenLabel } from "./usage-token-split";

/** Chart-only presentation; reported totals, exports and unknown run costs stay unchanged. */
export function usageChart(days: UsageDay[], metric: UsageMetric, mode: UsageCostMode) {
  const fallback = metric === "costUsd" && mode !== "hidden" && days.some(day => day.requests > 0) &&
    !days.some(day => day.requests > 0 && usageMetricValue(day, metric, mode) !== null);
  const displayedMetric: UsageMetric = fallback ? "requests" : metric;
  const data = days.map(day => ({ ...day, value: displayedMetric === "costUsd" && day.requests === 0 && mode !== "hidden"
    ? 0 : usageMetricValue(day, displayedMetric, mode) }));
  const values = data.map(day => day.value).filter((value): value is number => value !== null);
  return { data, metric: displayedMetric, label: fallback ? "Recorded requests" : metric === "costUsd" ? usageCostLabel(mode) : metric === "requests" ? "Requests" : usageTokenLabel(metric),
    note: fallback ? "Cost data is unavailable. Showing recorded requests instead." : metric === "costUsd" ? "Days without recorded activity show $0. Unreported run costs remain gaps." : null,
    singlePoint: values.length === 1, allZero: values.length > 0 && values.every(value => value === 0) };
}
