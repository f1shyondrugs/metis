export function scheduledUpdateScript(input:{command:string;args:string[];logFile:string;installRoot:string;packageUpdate:boolean;taskName:string}):string;
export function launchWindowsUpdateTask(input:{command:string;args:string[];logFile:string;installRoot:string;packageUpdate:boolean}):Promise<string>;
