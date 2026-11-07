export type ResearchCanvasArtifact = {
  id:string; type:"canvas"; name?:string; version?:number; createdAt?:string; updatedAt?:string;
  idempotencyKey?:string; workspaceLink:string; canvasId:string; markdown:string;
};
export function researchCanvasArtifact(canvas:unknown):ResearchCanvasArtifact;
