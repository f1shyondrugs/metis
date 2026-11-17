import{getAutomation,type Automation}from"./automations";import{getProject}from"./projects";import{referenceProject}from"./reference-appearance";import type{ReferenceResult}from"./reference-search";import type{Project}from"./store";
export function automationReference(automation:Automation,project?:Project|null):ReferenceResult{
 return{kind:"automation",id:automation.id,label:automation.name,icon:automation.icon,project:referenceProject(project),detail:automation.status+" · "+automation.timezone,content:JSON.stringify({id:automation.id,name:automation.name,prompt:automation.prompt.slice(0,6000),schedule:automation.schedule,timeZone:automation.timezone,status:automation.status})};
}
export function resolveAutomationReference(owner:string|undefined,id:string):ReferenceResult|null{
 if(!owner)return null;const automation=getAutomation(id,owner,false);if(!automation)return null;
 return automationReference(automation,automation.projectId?getProject(automation.projectId,owner):null);
}
