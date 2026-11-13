export type AppPlatform="windows"|"macos"|"linux"|"ios"|"android";
export type OnboardingPhase="welcome"|"app"|"device"|"done";
export type ClientOnboardingState={version:1;phase:OnboardingPhase;tourIndex:number};
export const PRODUCT_TOUR=[
 {id:"chat",label:"Chat",description:"Choose a model. Add files, voice or context with @.",action:"Open chat"},
 {id:"projects",label:"Projects",description:"Keep related chats, files and instructions together.",action:"Show projects"},
 {id:"notebooks",label:"Notebooks",description:"Notes, subpages and Issuebooks for your work.",action:"Open Notebooks"},
 {id:"tools",label:"Workspace",description:"Files, Browser, Desktops and Terminal — within your permissions.",action:"Show workspace"},
 {id:"agents",label:"Agent Hub",description:"Add skills, modes and reusable workflows.",action:"Open Agent Hub"},
 {id:"settings",label:"Settings",description:"Models, voice, connections and your custom theme.",action:"Open Settings"},
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
 try{const state=JSON.parse(raw||"null");if(state?.version===1&&["welcome","app","device","tour","done"].includes(state.phase)&&Number.isInteger(state.tourIndex)&&state.tourIndex>=0&&state.tourIndex<PRODUCT_TOUR.length)return state.phase==="tour"?{version:1,phase:"done",tourIndex:0}:{version:1,phase:state.phase,tourIndex:state.tourIndex};}catch{}
 return {version:1,phase:"welcome",tourIndex:0};
}
