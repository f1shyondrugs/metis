type WorkspaceLimitInput = { type?: string; idempotencyKey?: string };
export const WORKSPACE_MAX_CHARACTERS = 100_000;
export const RESEARCH_REPORT_MAX_BYTES = 500_000;

export function isResearchReportCanvas(workspace?: WorkspaceLimitInput | null) {
  return workspace?.type === "canvas" && Boolean(workspace.idempotencyKey?.endsWith(":research_report"));
}

/** Report Canvases keep the report tool limit across reading, editing and export. */
export function workspaceContentMaxLength(workspace?: WorkspaceLimitInput | null) {
  return isResearchReportCanvas(workspace) ? RESEARCH_REPORT_MAX_BYTES : WORKSPACE_MAX_CHARACTERS;
}

export function workspaceContentError(workspace: WorkspaceLimitInput | null | undefined, content: string): string | undefined {
  if (isResearchReportCanvas(workspace)) {
    if (new TextEncoder().encode(content).byteLength > RESEARCH_REPORT_MAX_BYTES) return "Research report exceeds 500,000 bytes.";
  } else if (content.length > WORKSPACE_MAX_CHARACTERS) {
    return "Workspace content exceeds 100,000 characters. Shorten the document before saving.";
  }
}
