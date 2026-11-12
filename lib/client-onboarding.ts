export type AppPlatform="windows"|"macos"|"linux"|"ios"|"android";
export type OnboardingPhase="welcome"|"app"|"device"|"tour"|"done";
export type ClientOnboardingState={version:1;phase:OnboardingPhase;tourIndex:number};
export const PRODUCT_TOUR=[
 {id:"chat",label:"Your first conversation",description:"Choose a model and access mode. Attach files, reference context with @, use voice, and queue a follow-up while Metis works.",action:"Open chat"},
 {id:"projects",label:"Keep work together",description:"Projects group conversations, shared instructions, memories and files. Start with an existing project or create one when you need it.",action:"Show projects"},
 {id:"notebooks",label:"A place for what matters",description:"Write notes, organise subpages and track work in Issuebooks. Chats can also hold editable Canvas and Plan workspaces.",action:"Open Notebooks"},
 {id:"tools",label:"Work beyond the conversation",description:"Use the workspace for Files, Browser, Desktops and Terminal. Tools and connected integrations follow your account and device permissions.",action:"Show workspace"},
 {id:"agents",label:"Make Metis yours",description:"Agent Hub brings together skills, modes and reusable workflows. Automation and remote control are optional; you choose what to enable.",action:"Open Agent Hub"},
 {id:"settings",label:"One place to configure",description:"Settings holds providers, models and model chains, voice, MCP connections, notifications and appearance. Your profile menu also opens usage and local app settings.",action:"Open Settings"},
] as const;
export type TourTarget=typeof PRODUCT_TOUR[number]["id"];
export function suggestedAppPlatform(input:{userAgent?:string;platform?:string;maxTouchPoints?:number}):AppPlatform|null{
 const ua=input.userAgent||"",platform=input.platform||"";
 if(/Android/i.test(ua))return "android";
 if(/iPhone|iPad|iPod/i.test(ua)||(/Mac/i.test(platform)&&Number(input.maxTouchPoints)>1))return "ios";
 if(/Win/i.test(platform)||/Windows/i.test(ua))return "windows";
 if(/Mac/i.test(platform)||/Macintosh/i.test(ua))return "macos";
 if(/Linux/i.test(platform)||/Linux/i.test(ua))return "linux";
 return null;
}
export function onboardingStorageKey(userId:string,clientId="browser"){return "metis:onboarding:v1:"+encodeURIComponent(userId)+":"+encodeURIComponent(clientId);}
export function parseOnboardingState(raw:string|null):ClientOnboardingState{
 try{const state=JSON.parse(raw||"null");if(state?.version===1&&["welcome","app","device","tour","done"].includes(state.phase)&&Number.isInteger(state.tourIndex)&&state.tourIndex>=0&&state.tourIndex<PRODUCT_TOUR.length)return {version:1,phase:state.phase,tourIndex:state.tourIndex};}catch{}
 return {version:1,phase:"welcome",tourIndex:0};
}
