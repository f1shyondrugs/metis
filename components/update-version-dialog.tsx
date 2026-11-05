"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UpdateCommitItem, UpdateReleaseItem, UpdateVersionList } from "@/lib/update-display";
import { cn } from "@/lib/utils";

type Tab = "releases" | "commits";

function formatWhen(value?: string | null) {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return date.toLocaleString("en");
}

export function UpdateVersionDialog({
  open,
  onOpenChange,
  busy,
  onInstall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onInstall: (input: { channel: Tab; tag?: string; commit?: string }) => Promise<void> | void;
}) {
  const [tab, setTab] = useState<Tab>("commits");
  const [data, setData] = useState<UpdateVersionList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void fetch("/api/admin/system/update/versions", { cache: "no-store" })
      .then(async (response) => {
        const next = (await response.json().catch(() => ({}))) as UpdateVersionList & { error?: string };
        if (!active) return;
        if (!response.ok) throw new Error(next.error || `Could not load versions (HTTP ${response.status}).`);
        setData(next);
        setSelectedRelease(next.releases.find((item) => item.current)?.tag || next.releases[0]?.tag || null);
        setSelectedCommit(next.commits.find((item) => item.current)?.sha || next.commits[0]?.sha || null);
      })
      .catch((loadError) => {
        if (active) {
          setData(null);
          setError(loadError instanceof Error ? loadError.message : "Could not load versions.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const release = useMemo(
    () => data?.releases.find((item) => item.tag === selectedRelease) || null,
    [data, selectedRelease],
  );
  const commit = useMemo(
    () => data?.commits.find((item) => item.sha === selectedCommit) || null,
    [data, selectedCommit],
  );
  const selected = tab === "releases" ? release : commit;
  const selectedLabel = tab === "releases"
    ? release?.tag || "this release"
    : commit?.shortSha || "this commit";

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="max-h-[min(40rem,calc(100vh-2rem))] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Download other version</DialogTitle>
            <DialogDescription>
              Pick a GitHub release or master commit. Installing it rebuilds Metis and restarts the services.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="min-h-0">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="commits">Commits</TabsTrigger>
              <TabsTrigger value="releases">Releases</TabsTrigger>
            </TabsList>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            {loading ? (
              <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <Skeleton className="h-56" />
                <Skeleton className="h-56" />
              </div>
            ) : null}
            {!loading && data ? (
              <>
                <TabsContent value="commits" className="mt-3">
                  <VersionSplit
                    items={data.commits.map((item) => ({
                      id: item.sha,
                      title: item.shortSha,
                      subtitle: item.title,
                      current: item.current,
                    }))}
                    selectedId={selectedCommit}
                    onSelect={setSelectedCommit}
                    empty="No master commits were returned."
                    detail={commit ? <CommitDetail commit={commit} /> : <p className="text-sm text-muted-foreground">Select a commit.</p>}
                  />
                </TabsContent>
                <TabsContent value="releases" className="mt-3">
                  <VersionSplit
                    items={data.releases.map((item) => ({
                      id: item.tag,
                      title: item.tag,
                      subtitle: item.name !== item.tag ? item.name : formatWhen(item.publishedAt),
                      current: item.current,
                    }))}
                    selectedId={selectedRelease}
                    onSelect={setSelectedRelease}
                    empty="No GitHub releases were returned."
                    detail={release ? <ReleaseDetail release={release} /> : <p className="text-sm text-muted-foreground">Select a release.</p>}
                  />
                </TabsContent>
              </>
            ) : null}
          </Tabs>
          <DialogFooter className="sm:justify-between">
            {selected && "htmlUrl" in selected ? (
              <a
                href={selected.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
                Open on GitHub
              </a>
            ) : <span />}
            <Button type="button" size="sm" disabled={busy || !selected} onClick={() => setConfirmOpen(true)}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Install this version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Install ${selectedLabel}?`}
        description="Metis will rebuild from this GitHub revision and restart. Keep this page open."
        confirmLabel="Install"
        destructive={false}
        onConfirm={async () => {
          if (tab === "releases" && release) await onInstall({ channel: "releases", tag: release.tag });
          if (tab === "commits" && commit) await onInstall({ channel: "commits", commit: commit.sha });
          onOpenChange(false);
        }}
      />
    </>
  );
}

function VersionSplit({
  items,
  selectedId,
  onSelect,
  empty,
  detail,
}: {
  items: { id: string; title: string; subtitle: string; current: boolean }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: string;
  detail: ReactNode;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid min-h-0 gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <ScrollArea className="h-56 rounded-md border border-border/70">
        <div className="p-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
                item.id === selectedId ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-1.5 font-mono text-xs">
                {item.title}
                {item.current ? <span className="font-sans text-[10px] uppercase tracking-wide text-foreground/70">current</span> : null}
              </span>
              <span className="line-clamp-1 text-[11px]">{item.subtitle}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="min-h-56 rounded-md border border-border/70 p-3">{detail}</div>
    </div>
  );
}

function ReleaseDetail({ release }: { release: UpdateReleaseItem }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{release.name}</p>
      <p className="text-xs text-muted-foreground">{release.tag} · {formatWhen(release.publishedAt)}{release.prerelease ? " · prerelease" : ""}</p>
      {release.body ? (
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5 text-muted-foreground">{release.body}</pre>
      ) : (
        <p className="text-xs text-muted-foreground">No release notes.</p>
      )}
    </div>
  );
}

function CommitDetail({ commit }: { commit: UpdateCommitItem }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{commit.title}</p>
      <p className="text-xs text-muted-foreground">{commit.shortSha} · {commit.author || "unknown author"} · {formatWhen(commit.authoredAt)}</p>
      {commit.body ? (
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5 text-muted-foreground">{commit.body}</pre>
      ) : (
        <p className="text-xs text-muted-foreground">No extra commit message.</p>
      )}
    </div>
  );
}
