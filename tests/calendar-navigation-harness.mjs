import fs from "node:fs";
import ts from "typescript";
const file=ts.createSourceFile("app-shell.tsx",fs.readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const handlers={};let effect="",reset="",navigate="",href="",calendar="",eventCallback="",openCalendar="";
function visit(n){
 if(ts.isVariableDeclaration(n)&&n.name.getText(file)==="openLinkedCalendarEvent")eventCallback=n.initializer.getText(file);
 if(ts.isFunctionDeclaration(n)&&n.name?.text==="chatHref")href=n.getText(file);
 if(ts.isFunctionDeclaration(n)&&n.name?.text==="openCalendar")openCalendar=n.getText(file);
 if(ts.isVariableDeclaration(n)&&n.name.getText(file)==="calendarOpen")calendar=n.initializer.getText(file);
 if(ts.isVariableDeclaration(n)&&n.name.getText(file)==="navigateChat")navigate=n.initializer.arguments[0].getText(file);
 if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==="button"){
  for(const [key,label] of [["openCalendar",">Calendar</span>"],["openNotes",">Notebooks</span>"],["openAutomations",">Automations</span>"]]){
   if(n.getText(file).includes(label)){
    const attr=n.openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(file)==="onClick");
    handlers[key]=attr.initializer.expression.getText(file);
   }
  }
 }
 if(ts.isCallExpression(n)&&n.expression.getText(file)==="useEffect"){
  const body=n.arguments[0]?.getText(file)||"";
  if(body.includes("const routeProjectId = parseProjectRouteId(routeChatId)"))effect=body;
  if(body==="() => setAccountView(null)")reset=body;
 }
 ts.forEachChild(n,visit);
}
visit(file);
if(!effect||!reset||!navigate||!href||!calendar||!openCalendar||Object.keys(handlers).length!==3)throw Error("Missing real calendar route, history or sidebar callbacks");
export function calendarNavigationHarnessSource(){
 const code=[
 "function createCalendarNavigationHarness(window) {",href,
 'let routeChatId=new URLSearchParams(window.location.search).get("c"),routeView=new URLSearchParams(window.location.search).get("view");',
 "let calendarOpen="+calendar+";",
 'const state={notesOpen:false,automationsOpen:false,workspaceOpen:true,workspaceFullscreen:true,mobileNavOpen:true,accountView:null,projectHomeId:null,focusedAutomationId:null,loads:[],snapshots:0};',
 'let notesOpen=false,automationsOpen=false;',
 'const authed=true,activeChatIncognito=false,activeChatIdRef={current:"fixture-chat"},suppressNotesRouteRef={current:false},draftProjectIdRef={current:null};',
 'const setAccountView=v=>state.accountView=v,setNotesOpen=v=>{state.notesOpen=v;notesOpen=v;},setAutomationsOpen=v=>{state.automationsOpen=v;automationsOpen=v;},setWorkspaceOpen=v=>state.workspaceOpen=v,setWorkspaceFullscreen=v=>state.workspaceFullscreen=v,setMobileNavOpen=v=>state.mobileNavOpen=v,setProjectHomeId=v=>state.projectHomeId=v,setFocusedAutomationId=v=>state.focusedAutomationId=v,setActiveChatId=v=>activeChatIdRef.current=v;',
 'const setSidebarAllProjects=()=>{},setDraftProjectId=()=>{};',
 'const parseProjectRouteId=id=>id?.startsWith("project:")?id.slice(8):null;',
 'const workspaceLinkRequestRef={current:0};const persistActiveSnapshot=()=>state.snapshots++;',
 'const loadChat=id=>{state.loads.push(id);activeChatIdRef.current=id;state.projectHomeId=null;state.accountView=null;};',
 'const openDraft=()=>{activeChatIdRef.current=null;state.notesOpen=false;state.automationsOpen=false;state.projectHomeId=null;};',
 "const navigateChat="+navigate+",resetAccount="+reset+",apply="+effect+";",
 "function reconcile(){",
 "// A stale effect must not act on a new native History URL.",
 "apply();",
 'const query=new URLSearchParams(window.location.search);routeChatId=query.get("c");routeView=query.get("view");calendarOpen='+calendar+";",
 "resetAccount();apply();",
 "}",
 openCalendar,
 "const openEventCallback="+eventCallback+";",
 "const callbacks={"+Object.entries(handlers).map(([k,v])=>k+":"+v).join(",")+"};",
 "return {state,get calendarOpen(){return calendarOpen;},get chatId(){return activeChatIdRef.current;},reconcile,",
 "openEvent(id){openEventCallback({detail:{id}});reconcile();},openCalendar(){callbacks.openCalendar();reconcile();},openNotes(){callbacks.openNotes();reconcile();},openAutomations(){callbacks.openAutomations();reconcile();},",
 "openChat(id){navigateChat(id);reconcile();},openDraft(){navigateChat(null);reconcile();}};",
 "}"].join("\n");
 return ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
