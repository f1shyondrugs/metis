"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUpdateInstalledLabel } from "@/lib/update-display";
import { UpdateLogsDialog } from "@/components/update-logs-dialog";
import { UpdateVersionDialog } from "@/components/update-version-dialog";
import { UpdateInstallConfirmation } from "@/components/update-install-confirmation";
import {
  activateInstallerMaintenanceScreen,
  installerJobFinishedMessage,
  pollInstallerJob,
  reloadCompletedInstallerJob,
  requestInstallerUpdate,
  type InstallerUpdateRequest,
  UPDATE_JOB_STORAGE_KEY,
} from "@/lib/update-job-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type UpdateChannel = "releases" | "commits";
type UpdateState = {
  status?: string;
  updateAvailable?: boolean;
  latestTag?: string;
  latestCommit?: string;
  currentManifest?: { version?: string; tag?: string | null; channel?: string };
};

const STORAGE_KEY = "metis-update-channel";

export function UpdateChannelNav({ isHostAdmin }: { isHostAdmin: boolean }) {
  const [channel, setChannel] = useState<UpdateChannel>("releases");
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "commits" || saved === "releases") setChannel(saved);
  }, []);

  useEffect(() => {
    if (!isHostAdmin) return;
    let active = true;
    void fetch(`/api/admin/system/update?channel=${channel}`, { cache: "no-store" })
      .then(async (response) => {
        const next = (await response.json().catch(() => ({}))) as UpdateState;
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState({ status: "check-failed" });
      });
    return () => { active = false; };
  }, [channel, isHostAdmin]);

  if (!isHostAdmin) return null;
  const available = Boolean(state?.updateAvailable);
  const label = available
    ? channel === "releases"
      ? `Release ${state?.latestTag || "available"}`
      : "Commit available"
    : channel === "releases"
      ? "Releases up to date"
      : "Commits up to date";

  return (
    <div className="mt-3 border-t border-border/60 pt-3 md:mt-auto md:pt-4" data-slot="update-channel-nav">
      <div className="flex items-center gap-2 px-2 text-xs font-medium text-foreground">
        <RefreshCw className={cn("size-3.5", available && "text-primary")} />
        Updates
      </div>
      <label className="mt-2 block px-2 text-[11px] text-muted-foreground" htmlFor="settings-update-channel">
        Track
      </label>
      <select
        id="settings-update-channel"
        value={channel}
        onChange={(event) => {
          const next = event.target.value as UpdateChannel;
          setChannel(next);
          window.localStorage.setItem(STORAGE_KEY, next);
        }}
        className="mt-1 h-8 w-[calc(100%-1rem)] rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="releases">Stable releases</option>
        <option value="commits">Master commits</option>
      </select>
      <p className={cn("mt-2 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground", available && "font-medium text-primary")}>
        <GitBranch className="size-3" />
        {label}
      </p>
    </div>
  );
}

type UpdateSettingsState = {
  status?: string;
  error?: string;
  updateAvailable?: boolean;
  latestTag?: string;
  latestCommit?: string;
  currentRef?: string;
  currentManifest?: { version?: string; tag?: string | null; commit?: string | null; channel?: string };
};

type UpdateScheduleState = {
  schedule?: { enabled: boolean; time: string; timezone: string };
  nextRunAt?: string | null;
};

export function UpdateStatusProbe({
  isHostAdmin,
  onUpdateAvailableChange,
}: {
  isHostAdmin: boolean;
  onUpdateAvailableChange: (available: boolean) => void;
}) {
  const [channel, setChannel] = useState<UpdateChannel>("releases");
  const [nextScheduledUpdate, setNextScheduledUpdate] = useState<string | null>(null);

  useEffect(() => {
    if (!isHostAdmin) return;
    let active = true;
    const loadSchedule = async () => {
      const response = await fetch("/api/admin/system/update-schedule", { cache: "no-store" });
      const next = (await response.json().catch(() => ({}))) as UpdateScheduleState;
      if (active) setNextScheduledUpdate(next.nextRunAt || null);
    };
    void loadSchedule().catch(() => undefined);
    const timer = window.setInterval(() => void loadSchedule().catch(() => undefined), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isHostAdmin]);

  useEffect(() => {
    if (!nextScheduledUpdate) return;
    const target = new Date(nextScheduledUpdate).getTime();
    const timers = [10, 5, 1].map((minutes) => window.setTimeout(() => toast.info(`Automatic update in ${minutes} minute${minutes === 1 ? "" : "s"}.`), Math.max(0, target - Date.now() - minutes * 60_000)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [nextScheduledUpdate]);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "commits" || saved === "releases") setChannel(saved);
  }, []);

  useEffect(() => {
    if (!isHostAdmin) {
      onUpdateAvailableChange(false);
      return;
    }
    let active = true;
    void fetch(`/api/admin/system/update?channel=${channel}`, { cache: "no-store" })
      .then(async (response) => {
        const next = (await response.json().catch(() => ({}))) as UpdateSettingsState;
        if (active) onUpdateAvailableChange(Boolean(next.updateAvailable));
      })
      .catch(() => {
        if (active) onUpdateAvailableChange(false);
      });
    return () => { active = false; };
  }, [channel, isHostAdmin, onUpdateAvailableChange]);

  return null;
}

export function UpdateSettingsPanel({
  isHostAdmin,
  onUpdateAvailableChange,
}: {
  isHostAdmin: boolean;
  onUpdateAvailableChange: (available: boolean) => void;
}) {
  const [channel, setChannel] = useState<UpdateChannel>("releases");
  const [state, setState] = useState<UpdateSettingsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [schedule, setSchedule] = useState<UpdateScheduleState | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<{ time: string; timezone: string } | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleLoadError, setScheduleLoadError] = useState("");
  const [scheduleSaveError, setScheduleSaveError] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [scheduleReload, setScheduleReload] = useState(0);
  const scheduleRequest = useRef({ revision: 0, saving: false });
  const savedSchedule = schedule?.schedule;
  const scheduleTime = scheduleDraft?.time ?? savedSchedule?.time ?? "";
  const scheduleTimezone = scheduleDraft?.timezone ?? savedSchedule?.timezone ?? "";
  const scheduleDirty = Boolean(savedSchedule &&
    (scheduleTime !== savedSchedule.time || scheduleTimezone !== savedSchedule.timezone));
  const [installChannel, setInstallChannel] = useState<UpdateChannel | null>(null);
  const updateStarting = useRef(false);
  const [otherVersionOpen, setOtherVersionOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    if (!isHostAdmin) return;
    let active = true;
    const loadSchedule = async () => {
      if (scheduleRequest.current.saving) return;
      const revision = ++scheduleRequest.current.revision;
      const isCurrent = () => active && revision === scheduleRequest.current.revision;
      try {
        const response = await fetch("/api/admin/system/update-schedule", { cache: "no-store" });
        const next = (await response.json().catch(() => ({}))) as UpdateScheduleState;
        if (!response.ok || !next.schedule) throw new Error("Could not load the update schedule.");
        if (!isCurrent()) return;
        setSchedule(next);
        setScheduleLoadError("");
      } catch {
        if (isCurrent()) setScheduleLoadError("Could not load the update schedule.");
      }
    };
    void loadSchedule();
    const timer = window.setInterval(() => void loadSchedule(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isHostAdmin, scheduleReload]);

  useEffect(() => {
    const savedJobId = window.localStorage.getItem(UPDATE_JOB_STORAGE_KEY);
    if (savedJobId) {
      setJobId(savedJobId);
      setPreparing(true);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "commits" || saved === "releases") setChannel(saved);
  }, []);

  useEffect(() => {
    if (!isHostAdmin) {
      onUpdateAvailableChange(false);
      return;
    }
    let active = true;
    void fetch(`/api/admin/system/update?channel=${channel}`, { cache: "no-store" })
      .then(async (response) => {
        const next = (await response.json().catch(() => ({}))) as UpdateSettingsState;
        if (!active) return;
        setState(next);
        onUpdateAvailableChange(Boolean(next.updateAvailable));
      })
      .catch(() => {
        if (active) {
          setState(null);
          onUpdateAvailableChange(false);
        }
      });
    return () => { active = false; };
  }, [channel, isHostAdmin, onUpdateAvailableChange]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const poll = async () => {
      try {
        const job = await pollInstallerJob(jobId);
        if (!active) return;
        if (job.status === "restarting") {
          setMessage("The installer is restarting Metis. Keep this page open.");
          return;
        }
        if (job.status === "ready") {
          if (reloadCompletedInstallerJob(jobId, job)) return;
          window.localStorage.removeItem(UPDATE_JOB_STORAGE_KEY);
          setPreparing(false);
          setJobId(null);
          setMessage(installerJobFinishedMessage(job.tag));
        } else if (job.status === "failed") {
          window.localStorage.removeItem(UPDATE_JOB_STORAGE_KEY);
          setPreparing(false);
          setJobId(null);
          setMessage(job.error || "Update preparation failed without a server detail.");
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not read update preparation status.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobId]);

  function editSchedule(draft: { time: string; timezone: string }) {
    setScheduleDraft(draft);
    setScheduleNotice("");
    setScheduleSaveError("");
  }

  async function saveSchedule(changes: { time: string; timezone: string } | { enabled: boolean }) {
    const request = scheduleRequest.current;
    if (!isHostAdmin || !savedSchedule || request.saving) return;
    request.saving = true;
    // A refresh that began before this write must not replace the confirmed result.
    request.revision++;
    setScheduleSaving(true);
    setScheduleNotice("");
    setScheduleSaveError("");
    try {
      const response = await fetch("/api/admin/system/update-schedule", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const next = (await response.json().catch(() => ({}))) as UpdateScheduleState & { error?: string };
      if (!response.ok || !next.schedule) throw new Error(next.error || "Could not save the update schedule. Try again.");
      setSchedule(next);
      setScheduleLoadError("");
      if ("time" in changes) {
        setScheduleDraft(null);
        setScheduleNotice("Schedule saved.");
      }
    } catch (error) {
      setScheduleSaveError(error instanceof Error ? error.message : "Could not save the update schedule. Try again.");
    } finally {
      request.saving = false;
      setScheduleSaving(false);
    }
  }

  async function installUpdate(body: InstallerUpdateRequest) {
    if (!isHostAdmin || preparing || updateStarting.current) throw new Error("An update cannot be started right now.");
    updateStarting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const { jobId: startedJobId, message: updateMessage } = await requestInstallerUpdate(body);
      setPreparing(true);
      setJobId(startedJobId);
      try {
        window.localStorage.setItem(UPDATE_JOB_STORAGE_KEY, startedJobId);
      } catch { /* The accepted job can still be tracked in this tab. */ }
      setMessage(updateMessage);
      activateInstallerMaintenanceScreen(updateMessage);
    } finally {
      updateStarting.current = false;
      setBusy(false);
    }
  }

  if (!isHostAdmin) {
    return <p className="text-sm text-muted-foreground">Updates are available to host administrators.</p>;
  }
  const available = Boolean(state?.updateAvailable);
  const checkFailed = state?.status === "check-failed";
  const current = formatUpdateInstalledLabel(
    channel,
    state?.currentRef || state?.currentManifest?.commit,
    state?.currentManifest?.tag || state?.currentManifest?.version,
  );
  const target = checkFailed
    ? "GitHub check failed"
    : channel === "releases" ? state?.latestTag || "latest stable release" : state?.latestCommit?.slice(0, 12) || "latest master commit";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-sm font-medium">Updates</h3>
        <p className="mt-1 text-xs text-muted-foreground">Choose whether Metis follows stable releases or the latest master commits. Installing an update restarts Metis services.</p>
      </div>
      <label className="block max-w-sm text-xs font-medium" htmlFor="settings-update-channel-panel">
        Update channel
        <select
          id="settings-update-channel-panel"
          value={channel}
          onChange={(event) => {
            const next = event.target.value as UpdateChannel;
            if (next !== channel) setState(null);
            setChannel(next);
            setMessage("");
            window.localStorage.setItem(STORAGE_KEY, next);
          }}
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="releases">Stable releases</option>
          <option value="commits">Master commits (may be buggy or broken)</option>
        </select>
      </label>
      <div className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        available ? "border-emerald-500/40 bg-emerald-500/10" : "border-border/60 bg-muted/20",
      )} role="status" aria-live="polite">
        <RefreshCw className={cn("mt-0.5 size-4 shrink-0", available ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
        <div>
          <p className={cn("text-sm font-medium", available && "text-emerald-700 dark:text-emerald-300")}>
            {available ? "Update Available" : checkFailed ? "Could not check for updates" : "No updates available"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Installed: {current} · Tracking: {target}
          </p>
          {checkFailed && state?.error ? (
            <p className="mt-1 text-xs text-muted-foreground">{state.error}</p>
          ) : null}
        </div>
      </div>
      {available && (channel === "releases" || channel === "commits") ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setInstallChannel(channel)} disabled={busy || preparing}>
            {busy || preparing ? <><LoaderCircle className="size-4 animate-spin" /> Installing…</> : "Install update"}
          </Button>
        </div>
      ) : null}
      {message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
      <div className="space-y-3 border-t border-border/60 pt-5">
        <div>
          <h4 className="text-sm font-medium">Automatic updates</h4>
          <p className="mt-1 text-xs text-muted-foreground">Check for stable releases daily at the saved time. If an update is available, installing it restarts Metis services.</p>
        </div>
        {savedSchedule ? (
          <>
            <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
              event.preventDefault();
              if (scheduleDirty && scheduleTime && scheduleTimezone.trim()) {
                void saveSchedule({ time: scheduleTime, timezone: scheduleTimezone.trim() });
              }
            }}>
              <label className="text-xs font-medium">
                Time
                <input type="time" required disabled={scheduleSaving} value={scheduleTime}
                  onChange={(event) => editSchedule({ time: event.target.value, timezone: scheduleTimezone })}
                  className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50" />
              </label>
              <label className="text-xs font-medium">
                Timezone
                <input required disabled={scheduleSaving} value={scheduleTimezone}
                  onChange={(event) => editSchedule({ time: scheduleTime, timezone: event.target.value })}
                  className="mt-1 block h-9 w-48 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50" />
              </label>
              <Button type="submit" size="sm" variant="outline"
                disabled={scheduleSaving || !scheduleDirty || !scheduleTime || !scheduleTimezone.trim()}>
                Save schedule
              </Button>
            </form>
            {scheduleDirty ? <p className="text-xs text-muted-foreground">Unsaved changes. Turning automatic updates on or off uses the saved schedule.</p> : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button type="button" size="sm" disabled={scheduleSaving}
                onClick={() => void saveSchedule({ enabled: !savedSchedule.enabled })}>
                {savedSchedule.enabled ? "Disable automatic updates" : "Enable automatic updates"}
              </Button>
              <p className="text-xs text-muted-foreground" role="status">
                {savedSchedule.enabled ? "Enabled" : "Disabled"} · Saved: {savedSchedule.time} ({savedSchedule.timezone})
              </p>
            </div>
            {schedule?.nextRunAt && savedSchedule.enabled ? (
              <p className="text-xs text-muted-foreground">Next check: {new Date(schedule.nextRunAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: savedSchedule.timezone })} ({savedSchedule.timezone})</p>
            ) : null}
          </>
        ) : !scheduleLoadError ? <p className="text-xs text-muted-foreground" role="status">Loading update schedule…</p> : null}
        {scheduleSaving || scheduleNotice ? <p className="text-xs text-muted-foreground" role="status">{scheduleSaving ? "Saving…" : scheduleNotice}</p> : null}
        {scheduleSaveError ? <p className="text-xs text-destructive" role="alert">{scheduleSaveError}</p> : null}
        {scheduleLoadError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-destructive" role="alert">{scheduleLoadError}</p>
            <Button type="button" variant="outline" size="sm" disabled={scheduleSaving} onClick={() => setScheduleReload((attempt) => attempt + 1)}>Retry</Button>
          </div>
        ) : null}
      </div>
      {available && channel === "commits" ? (
        <p className="text-xs text-muted-foreground">This runs the installer against the current checkout (git pull on master, then rebuild and restart). Master commits may be buggy or broken.</p>
      ) : null}
      <div className="space-y-2 border-t border-border/60 pt-5">
        <h4 className="text-sm font-medium">Other versions</h4>
        <p className="text-xs text-muted-foreground">Install an older or specific GitHub release or master commit.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setOtherVersionOpen(true)} disabled={busy || preparing}>
          Download other version
        </Button>
      </div>
      <div className="space-y-2 border-t border-border/60 pt-5">
        <h4 className="text-sm font-medium">Update logs</h4>
        <p className="text-xs text-muted-foreground">See which version an update started from, which version it targeted, and the installer output.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setLogsOpen(true)}>
          View update logs
        </Button>
      </div>
      <UpdateInstallConfirmation
        open={installChannel !== null}
        onOpenChange={(open) => { if (!open) setInstallChannel(null); }}
        target={installChannel === "commits" ? "the latest master commit" : "the latest stable release"}
        onConfirm={() => {
          if (installChannel) return installUpdate({ channel: installChannel });
        }}
      />
      <UpdateLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
      <UpdateVersionDialog
        open={otherVersionOpen}
        onOpenChange={setOtherVersionOpen}
        busy={busy || preparing}
        onInstall={installUpdate}
      />
    </div>
  );
}
