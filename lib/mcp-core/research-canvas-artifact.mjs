/** One compact artifact shape for current and legacy research report delivery. */
export function researchCanvasArtifact(canvas) {
  if (!canvas || typeof canvas !== "object" || canvas.type !== "canvas" ||
      typeof canvas.id !== "string" || !/^[^/?#\s]+$/.test(canvas.id) ||
      canvas.workspaceLink !== `workspace://canvas/${canvas.id}`) {
    throw new Error("Research report Canvas was not confirmed");
  }
  const {id,type,name,version,createdAt,updatedAt,idempotencyKey,workspaceLink}=canvas;
  return {id,type,name,version,createdAt,updatedAt,idempotencyKey,workspaceLink,
    canvasId:id,markdown:`[Open report in Canvas](${workspaceLink})`};
}
