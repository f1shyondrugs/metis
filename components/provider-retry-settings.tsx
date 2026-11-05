"use client";
import { ProviderRecoverySetting } from "@/components/provider-recovery-setting";

export function ProviderRetrySettings() {
  return <ProviderRecoverySetting endpoint="/api/agent-settings/provider-retry" id="provider-error-retry"
    label="Automatically retry provider errors"
    description="Continue the same run after any run error, with up to 3 retries. Known usage resets are handled by the limit-wait setting. Disabled by default."
    applicability="Changes apply to the next provider error. Use Stop to cancel a run." />;
}
