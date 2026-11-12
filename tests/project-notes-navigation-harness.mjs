import fs from 'node:fs';
import ts from 'typescript';
const file=ts.createSourceFile('app-shell.tsx',fs.readFileSync(new URL('../components/app-shell.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler,effect;
function visit(node){
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ProjectHome'){
  const attribute=node.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText(file)==='onOpenNotes');
  handler=attribute?.initializer?.expression?.getText(file);
 }
 if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('const routeProjectId = parseProjectRouteId(routeChatId)'))effect=node.arguments[0].getText(file);
 ts.forEachChild(node,visit);
}
visit(file);if(!handler||!effect)throw Error('Could not locate actual project notes callback and route effect.');
const code=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
export function notesNavigationHarnessSource(){
 return code(`function createNotesNavigationHarness(){
  let url=new URL('http://fixture/?c=project%3Afixture-project');
  const state={notesOpen:false,focusedNoteId:null,projectHomeId:'fixture-project',workspaceOpen:true,workspaceFullscreen:true,automationsOpen:false,accountView:null,mobileNavOpen:true};
  let routeChatId='project:fixture-project',routeView=null;const authed=true,activeChatIncognito=false,activeChatIdRef={current:null},suppressNotesRouteRef={current:false},draftProjectIdRef={current:'fixture-project'};
  const window={get location(){return url;}};
  const setNotesOpen=value=>{state.notesOpen=value;},setFocusedNoteId=value=>{state.focusedNoteId=value;},setProjectHomeId=value=>{state.projectHomeId=value;},
    setWorkspaceOpen=value=>{state.workspaceOpen=value;},setWorkspaceFullscreen=value=>{state.workspaceFullscreen=value;},
    setAutomationsOpen=value=>{state.automationsOpen=value;},setAccountView=value=>{state.accountView=value;},setMobileNavOpen=value=>{state.mobileNavOpen=value;};
  const setSidebarAllProjects=()=>{},persistActiveSnapshot=()=>{},setActiveChatId=()=>{},setDraftProjectId=()=>{},loadChat=()=>{},openDraft=()=>{};
  const parseProjectRouteId=id=>id?.startsWith('project:')?id.slice(8):null;
  const navigateChat=id=>{url=new URL('http://fixture/?c='+encodeURIComponent(id));};
  const onOpenNotes=${handler},applyRoute=${effect};
  function open(noteId){
   onOpenNotes(noteId);
   // React can run the old route effect once while router props catch up.
   applyRoute();routeChatId=url.searchParams.get('c');applyRoute();
   return {...state,url:url.pathname+url.search};
  }
  return {open,state};
 }`);
}
