import type{Project}from"./store";
import type{ReferenceResult}from"./reference-search";
/** Only the visible project's display projection, never its instructions or membership. */
export function referenceProject(project:Project|undefined|null):ReferenceResult["project"]{
 if(!project)return undefined;
 return{id:project.id,name:project.name,icon:project.icon,color:project.color,...(project.logoStoredName?{logoStoredName:project.logoStoredName}:{}),updatedAt:project.updatedAt};
}
