import type { ProviderRetryPart } from "@/lib/provider-retry";
import { RunEventDivider } from "@/components/run-event-divider";

export function ProviderRetryEvent({ event }: { event: ProviderRetryPart }) {
  return <RunEventDivider event={event} />;
}
