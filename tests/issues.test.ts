import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import test,{before,after} from "node:test";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-issues-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"issues.sqlite"),AGENT_CWD:root,CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false",NODE_ENV:"test",MCP_BEARER_TOKEN:"synthetic-issues-test-token",AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",AI_CHAT_ISSUES_URL:"http://127.0.0.1:1/api/internal/mcp-issues",AI_CHAT_MCP_STATE_DIR:path.join(root,"mcp-state")});
delete process.env.AI_CHAT_TEST_BYPASS_LEASE;
const imports=Promise.all([import("../lib/auth"),import("../lib/projects"),import("../lib/shared-context"),import("../lib/project-sharing"),import("../lib/sqlite"),import("../lib/issues")]);
let modules:Awaited<typeof imports>;
let owner:string,member:string,stranger:string,projectId:string,otherProjectId:string,noteId:string,privateNoteId:string,issueId:string,childId:string;
let tokens:{owner:string;member:string;stranger:string};
before(async()=>{
  modules=await imports;
  const [auth,projects,notes,sharing]=modules;
  owner=auth.createUser("issue-owner","password123").id;
  member=auth.createUser("issue-member","password123").id;
  stranger=auth.createUser("issue-stranger","password123").id;
  projectId=projects.createProject({ownerId:owner,name:"Issues project"}).id;
  otherProjectId=projects.createProject({ownerId:owner,name:"Other project"}).id;
  const invitation=sharing.inviteProjectMember(projectId,owner,"issue-member");
  sharing.respondProjectInvitation(invitation.id,member,"accept");
  noteId=notes.createNote({ownerId:owner,projectId,title:"Launch plan",content:"- [ ] Ship release"}).id;
  privateNoteId=notes.createNote({ownerId:owner,title:"Private page",content:"Secret"}).id;
  tokens={owner:auth.authenticateUser("issue-owner","password123")!.token,member:auth.authenticateUser("issue-member","password123")!.token,stranger:auth.authenticateUser("issue-stranger","password123")!.token};
});
after(()=>{modules?.[4].getDatabase().close();rmSync(root,{recursive:true,force:true});});
const req=(url:string,token?:string,method="GET",body?:unknown)=>new Request("http://localhost"+url,{method,headers:{...(token?{cookie:"ai_chat_auth="+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});

test("project issues persist with stable keys and accept valid member fields",()=>{
  const issues=modules[5];
  const issue=issues.createIssue(member,{projectId,title:"Ship release",description:"## Plan\nVerify the build",status:"todo",priority:"high",labels:["release","release"],assigneeId:owner,dueDate:"2026-12-01"});
  issueId=issue.id;
  assert.match(issue.key,/^IP-\d+$/);assert.equal(issue.ownerId,owner);assert.equal(issue.creatorId,member);
  assert.deepEqual(issue.labels,["release"]);
  const updated=issues.updateIssue(issue.id,owner,{title:"Ship release safely",status:"in_progress",expectedVersion:1});
  assert.equal(updated.key,issue.key);assert.equal(updated.version,2);
  assert.equal(issues.getIssue(issue.id,member)?.title,"Ship release safely");
  const independent=new DatabaseSync(path.join(root,"issues.sqlite"));
  const row=independent.prepare("SELECT data FROM issues WHERE id=?").get(issue.id) as {data:string};
  assert.equal(JSON.parse(row.data).status,"in_progress");independent.close();
  assert.throws(()=>issues.updateIssue(issue.id,owner,{expectedVersion:1,title:"Stale edit"}),/changed/);
  assert.throws(()=>issues.createIssue(owner,{projectId,title:"Bad assignment",assigneeId:stranger}),/member/);
  assert.throws(()=>issues.updateIssue(issue.id,owner,{dueDate:"2026-02-30"}),/valid due date/);
  assert.throws(()=>issues.updateIssue(issue.id,owner,{status:"unknown" as never}),/status/);
});

test("project key prefixes are unique, remain stable on rename, and preserve existing keys after deletion",()=>{
  const [,projects,,,sqlite,issues]=modules;
  const first=projects.createProject({ownerId:owner,name:"Roblox"});
  const second=projects.createProject({ownerId:owner,name:"Robust"});
  const third=projects.createProject({ownerId:owner,name:"Robot"});
  const a=issues.createIssue(owner,{projectId:first.id,title:"First keyed issue"});
  const b=issues.createIssue(owner,{projectId:second.id,title:"Second keyed issue"});
  const c=issues.createIssue(owner,{projectId:third.id,title:"Third keyed issue"});
  assert.equal(a.key.split("-")[0],"ROB");assert.equal(b.key.split("-")[0],"ROB2");assert.equal(c.key.split("-")[0],"ROB3");
  projects.updateProject(first.id,{name:"Completely renamed"},owner);
  const later=issues.createIssue(owner,{projectId:first.id,title:"Created after rename"});
  assert.equal(later.key.split("-")[0],"ROB");assert.equal(issues.getIssue(a.id,owner)?.key,a.key);
  // Emulate an existing pre-prefix issue; allocating a project prefix never rewrites it.
  const legacyKey="ISS-900001",db=sqlite.getDatabase();
  db.prepare("UPDATE issues SET issue_key=?,data=json_set(data,'$.key',?) WHERE id=?").run(legacyKey,legacyKey,c.id);
  issues.createIssue(owner,{projectId:third.id,title:"New issue beside a legacy key"});
  assert.equal(issues.getIssue(c.id,owner)?.key,legacyKey);
  assert.ok(projects.deleteProject(second.id,owner));
  assert.equal(issues.getIssue(b.id,owner)?.key,b.key);assert.equal(issues.getIssue(b.id,owner)?.projectId,null);
  const privateIssue=issues.createIssue(owner,{title:"Private issue namespace"});
  assert.match(privateIssue.key,/^ISS-\d+$/);
  const reserved=projects.createProject({ownerId:owner,name:"Issue System Services"});
  assert.notEqual(issues.createIssue(owner,{projectId:reserved.id,title:"Reserved prefix"}).key.split("-")[0],"ISS");
});

test("No Project is owner-only and inaccessible to project peers and unrelated accounts",()=>{
  const issues=modules[5];
  const privateIssue=issues.createIssue(owner,{projectId:null,title:"Private follow-up",assigneeId:owner});
  assert.equal(issues.getIssue(privateIssue.id,member),null);
  assert.equal(issues.getIssue(privateIssue.id,stranger),null);
  assert.equal(issues.listIssues(member).length,0);
  assert.throws(()=>issues.updateIssue(privateIssue.id,member,{title:"Injected"}),/not found/);
  assert.throws(()=>issues.deleteIssue(privateIssue.id,stranger),/not found/);
  assert.throws(()=>issues.createIssue(stranger,{projectId,title:"Injected"}),/not found/);
  assert.throws(()=>issues.listIssues(stranger,{projectId}),/not found/);
  assert.throws(()=>issues.createIssue(owner,{title:"Bad private assignment",assigneeId:member}),/member/);
});

test("page conversion is idempotent across collaborators and validates page ACL/container",()=>{
  const issues=modules[5];
  const source={noteId,sourceId:"block-checkbox-1",kind:"checkbox" as const,excerpt:"Ship release"};
  const first=issues.createIssue(owner,{projectId,title:"Convert checkbox",source});
  const retry=issues.createIssue(member,{projectId,title:"Second click",source});
  assert.equal(retry.id,first.id);assert.equal(retry.title,"Convert checkbox");
  assert.equal(issues.listIssues(member,{projectId,noteId}).length,1);
  const selection=issues.createIssue(member,{projectId,title:"Convert selection",source:{noteId,sourceId:"selection-4-23",kind:"selection",excerpt:"release"}});
  assert.notEqual(selection.id,first.id);
  assert.throws(()=>issues.createIssue(member,{projectId,title:"Private source",source:{...source,noteId:privateNoteId}}),/Source page/);
  assert.throws(()=>issues.createIssue(owner,{projectId:otherProjectId,title:"Wrong project",source}),/Source page/);
  assert.throws(()=>issues.listIssues(member,{projectId,noteId:privateNoteId}),/not found/);
  const keyed=issues.createIssue(owner,{projectId,title:"Network retry"},"create-request-1");
  assert.equal(issues.createIssue(owner,{projectId,title:"Retry title"},"create-request-1").id,keyed.id);
});

test("subissues and blocking relations reject cycles and foreign containers",()=>{
  const issues=modules[5];
  const child=issues.createIssue(member,{projectId,title:"Verify release",parentId:issueId});childId=child.id;
  assert.equal(issues.getIssueDetail(issueId,owner).subissues[0].id,child.id);
  assert.throws(()=>issues.updateIssue(issueId,owner,{parentId:child.id}),/cycle/);
  const privateIssue=issues.createIssue(owner,{title:"Private child"});
  assert.throws(()=>issues.updateIssue(child.id,owner,{parentId:privateIssue.id}),/same project/);
  const relation=issues.addIssueRelation(issueId,owner,child.id,"blocks");
  assert.equal(issues.addIssueRelation(issueId,member,child.id,"blocks").id,relation.id);
  assert.throws(()=>issues.addIssueRelation(child.id,member,issueId,"blocks"),/cycle/);
  assert.throws(()=>issues.addIssueRelation(issueId,owner,privateIssue.id,"related"),/same project/);
  const related=issues.addIssueRelation(issueId,owner,child.id,"related");
  assert.equal(issues.addIssueRelation(child.id,member,issueId,"related").id,related.id);
  assert.equal(issues.getIssueDetail(child.id,member).relations.length,2);
  issues.removeIssueRelation(issueId,member,related.id);
  assert.equal(issues.getIssueDetail(child.id,owner).relations.length,1);
});

test("comments and history survive reads while bulk updates are atomic",()=>{
  const issues=modules[5];
  const comment=issues.addIssueComment(issueId,member,"Checked on staging.");
  assert.equal(comment.authorId,member);
  const detail=issues.getIssueDetail(issueId,owner);
  assert.equal(detail.comments[0].body,"Checked on staging.");
  assert.equal(detail.history.some(item=>item.action==="created"),true);
  assert.equal(detail.history.some(item=>item.changes.status?.after==="in_progress"),true);
  assert.equal(detail.history.some(item=>item.action==="commented"),true);
  issues.bulkUpdateIssues(owner,[issueId,childId],{priority:"urgent",status:"todo"});
  assert.equal(issues.getIssue(childId,owner)?.priority,"urgent");
  const foreign=issues.createIssue(stranger,{title:"Unrelated issue"});
  assert.throws(()=>issues.bulkUpdateIssues(owner,[issueId,foreign.id],{status:"done"}),/not found/);
  assert.equal(issues.getIssue(issueId,owner)?.status,"todo");
});

test("saved views and My issues preferences are scoped by account and project",()=>{
  const issues=modules[5];
  const saved=issues.saveIssueSettings(owner,projectId,{layout:"board",filters:{mine:true,status:"todo"},savedViews:[{id:"mine",name:"My release work",filters:{mine:true,label:"release"}}]});
  assert.equal(saved.filters.mine,true);assert.equal(saved.layout,"board");
  assert.equal(issues.getIssueSettings(owner,projectId).savedViews.length,1);
  assert.equal(issues.getIssueSettings(member,projectId).savedViews.length,0);
  assert.equal(issues.getIssueSettings(owner,null).savedViews.length,0);
  assert.equal(issues.getIssueSettings(owner,otherProjectId).layout,"list");
  assert.throws(()=>issues.getIssueSettings(stranger,projectId),/not found/);
});

test("authenticated APIs enforce actor identity, malformed input, comments, relations and filtering",async()=>{
  const route=await import("../app/api/issues/route");
  const single=await import("../app/api/issues/[id]/route");
  const comments=await import("../app/api/issues/[id]/comments/route");
  const relations=await import("../app/api/issues/[id]/relations/route");
  const views=await import("../app/api/issues/views/route");
  const ctx={params:Promise.resolve({id:issueId})};
  assert.equal((await route.GET(req("/api/issues?projectId="+projectId))).status,401);
  assert.equal((await route.GET(req("/api/issues?projectId="+projectId,tokens.stranger))).status,404);
  const list=await route.GET(req("/api/issues?projectId="+projectId,tokens.member));
  assert.equal(list.status,200);
  const data=await list.json();
  assert.equal(data.currentUserId,member);assert.equal(data.members.length,2);
  assert.equal(data.settings.savedViews.length,0);
  assert.equal((await single.GET(req("/api/issues/"+issueId,tokens.stranger),ctx)).status,404);
  assert.equal((await single.PATCH(req("/api/issues/"+issueId,tokens.member,"PATCH",{status:"done",ownerId:stranger}),ctx)).status,200);
  assert.equal(modules[5].getIssue(issueId,owner)?.ownerId,owner);
  const snapshot=modules[5].getIssue(issueId,owner)!;
  assert.equal((await single.PATCH(req("/api/issues/"+issueId,tokens.owner,"PATCH",{priority:"high",expectedVersion:snapshot.version}),ctx)).status,200);
  assert.equal((await single.PATCH(req("/api/issues/"+issueId,tokens.owner,"PATCH",{priority:"low",expectedVersion:snapshot.version}),ctx)).status,409);
  assert.equal(modules[5].getIssue(issueId,owner)?.priority,"high");
  assert.equal((await route.POST(req("/api/issues",tokens.owner,"POST",{title:"",projectId}))).status,400);
  assert.equal((await route.POST(req("/api/issues",tokens.owner,"POST",[]))).status,400);
  assert.equal((await comments.POST(req("/api/issues/"+issueId+"/comments",tokens.member,"POST",{body:"API comment"}),ctx)).status,201);
  assert.equal((await comments.POST(req("/api/issues/"+issueId+"/comments",tokens.stranger,"POST",{body:"Injected"}),ctx)).status,404);
  assert.equal((await relations.POST(req("/api/issues/"+issueId+"/relations",tokens.stranger,"POST",{targetId:childId,kind:"related"}),ctx)).status,404);
  assert.equal((await views.PUT(req("/api/issues/views",tokens.stranger,"PUT",{projectId,settings:{layout:"board"}}))).status,404);
  const backlinks=await route.GET(req("/api/issues?noteId="+noteId,tokens.member));
  assert.equal((await backlinks.json()).issues.length,2);
  const store=await import("../lib/db-store"),settings=store.getGlobalModelSettings(owner);
  store.saveGlobalModelSettings({...settings,featureFlags:{...settings.featureFlags,notes:false}},owner);
  try {
    assert.equal((await route.GET(req("/api/issues?projectId="+projectId,tokens.owner))).status,404);
    assert.equal((await route.GET(req("/api/issues?projectId="+projectId,tokens.member))).status,200);
  } finally {store.saveGlobalModelSettings(settings,owner);}
});

test("deleting a parent preserves subissues and removes comments and relation records",()=>{
  const issues=modules[5],db=modules[4].getDatabase();
  const parent=issues.createIssue(owner,{projectId,title:"Disposable parent"});
  const child=issues.createIssue(owner,{projectId,title:"Keep me",parentId:parent.id});
  issues.addIssueComment(parent.id,owner,"Disposable comment");
  issues.addIssueRelation(parent.id,owner,child.id,"related");
  issues.deleteIssue(parent.id,member);
  assert.equal(issues.getIssue(parent.id,owner),null);
  assert.equal(issues.getIssue(child.id,owner)?.parentId,null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM issue_comments WHERE issue_id=?").get(parent.id) as {n:number}).n,0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM issue_relations WHERE issue_id=? OR target_id=?").get(parent.id,parent.id) as {n:number}).n,0);
});

test("gateway issue tools use the actual bearer, run lease, actor identity and explicit project boundary",async(t)=>{
  const [chats,jobs,route,gateway,notesRoute]=await Promise.all([import("../lib/db-store"),import("../lib/db-jobs"),import("../app/api/internal/mcp-issues/route"),import("../lib/mcp-core/gateway-core.mjs"),import("../app/api/internal/mcp-notes/route")]);
  const chat=chats.createChat("Issue tool run",undefined,owner,undefined,{projectId});
  const job=jobs.enqueueJob({chatId:chat.id,userId:owner,message:"Track release work"});
  const claimed=jobs.claimNextJob({workerId:"issue-test-worker"})!;
  assert.equal(claimed.id,job.id);
  const headers={Authorization:"Bearer synthetic-issues-test-token","Content-Type":"application/json","x-ai-chat-id":chat.id,"x-ai-chat-user-id":owner,"x-ai-chat-job-id":job.id,"x-ai-chat-worker-id":claimed.leaseOwner!,"x-ai-chat-lease-token":claimed.leaseToken!};
  const direct=(body:unknown,patch:Record<string,string>={})=>route.POST(new Request("http://localhost/api/internal/mcp-issues",{method:"POST",headers:{...headers,...patch},body:JSON.stringify(body)}));
  assert.equal((await direct({action:"list",projectId},{"x-ai-chat-lease-token":""})).status,401);
  assert.equal((await direct({action:"list",projectId},{Authorization:"Bearer wrong"})).status,401);
  assert.equal((await direct({action:"list",projectId},{"x-ai-chat-user-id":member})).status,403);
  assert.equal((await direct({action:"list",projectId},{"x-ai-chat-incognito":"1"})).status,403);
  assert.equal((await direct({action:"list"})).status,400);
  assert.equal((await direct({action:"list",projectId:"none"})).status,200);
  const context={userId:owner,chatId:chat.id,jobId:job.id,workerId:claimed.leaseOwner!,leaseToken:claimed.leaseToken!,source:"agent",runtimeMode:"full-access"};
  const intercepted:string[]=[];
  t.mock.method(globalThis,"fetch",async(input:string|URL|Request,init?:RequestInit)=>{
    const request=new Request(input,init);
    if(new URL(request.url).pathname==="/api/internal/mcp-issues"){
      intercepted.push(request.headers.get("x-ai-chat-job-id")||"");
      return route.POST(request);
    }
    if(new URL(request.url).pathname==="/api/internal/mcp-notes")return notesRoute.POST(request);
    return Response.json({waitingForUser:false,required:false});
  });
  const call=(name:string,args:Record<string,unknown>,override={})=>gateway.dispatchGatewayTool(name,args,{auditCall:false,context:{...context,...override}});
  const parse=(result:{isError?:boolean;content?:Array<{type:string;text?:string}>})=>{
    assert.equal(result.isError===true,false,JSON.stringify(result));
    return JSON.parse(result.content?.find(item=>item.type==="text")?.text||"{}");
  };
  for(const name of ["list_issues","get_issue","create_issue","update_issue","delete_issue","add_issue_comment","link_issues"]){
    const tool=gateway.tools.find((tool:{name:string})=>tool.name===name);
    assert.ok(tool);
    const required=tool.inputSchema.required;
    assert.ok(Array.isArray(required));assert.ok(required.includes("projectId"));
  }
  for(const name of ["create_note","update_note"]){
    const tool=gateway.tools.find((tool:{name:string})=>tool.name===name);
    assert.ok(tool);
    const properties=tool.inputSchema.properties;
    assert.ok(properties&&typeof properties==="object"&&!Array.isArray(properties));
    for(const field of ["parentId","sortKey","icon","cover","fullWidth","favorite"])assert.ok(Object.prototype.hasOwnProperty.call(properties,field));
  }
  const created=parse(await call("create_issue",{projectId,title:"Created by gateway",assigneeId:member,idempotencyKey:"gateway-create"})).issue;
  assert.equal(created.creatorId,owner);
  assert.equal(parse(await call("create_issue",{projectId,title:"Retry",idempotencyKey:"gateway-create"})).issue.id,created.id);
  assert.equal(parse(await call("list_issues",{projectId,search:"Created by gateway"})).issues[0].id,created.id);
  assert.equal(parse(await call("get_issue",{projectId,id:created.id})).issue.key,created.key);
  assert.equal(parse(await call("update_issue",{projectId,id:created.id,status:"in_progress"})).issue.status,"in_progress");
  assert.equal(parse(await call("add_issue_comment",{projectId,id:created.id,body:"Gateway comment"})).comment.authorId,owner);
  assert.equal(parse(await call("link_issues",{projectId,id:created.id,targetId:issueId,kind:"related"})).relation.kind,"related");
  assert.equal((await call("get_issue",{projectId:"none",id:created.id})).isError,true);
  assert.equal((await call("list_issues",{projectId},{incognito:true})).isError,true);
  assert.equal((await call("create_issue",{projectId,title:"Denied"},{leaseToken:"invalid"})).isError,true);
  assert.equal(parse(await call("delete_issue",{projectId,id:created.id})).ok,true);
  const pageResult=parse(await call("create_note",{title:"Gateway parent page",projectId,parentId:null,sortKey:4096,icon:"📓",cover:"https://example.com/cover.png",fullWidth:true,favorite:true,scope:"global",idempotencyKey:"gateway-page-create"}));
  const page=pageResult.note;
  assert.equal(pageResult.noteLink,"note://"+page.id);
  assert.equal(pageResult.markdown,"[Gateway parent page](note://"+page.id+")");
  assert.equal(page.projectId,projectId);assert.equal(page.sortKey,4096);assert.equal(page.fullWidth,true);assert.equal(page.favorite,true);assert.equal(page.icon,"📓");
  assert.equal(page.cover,"https://example.com/cover.png");
  // Exercise appearance through the actual gateway, leased API and persisted note,
  // including structured icons and banner framing rather than only schema presence.
  const icon="lucide:book-open:#22c55e";
  const cover="https://example.com/banner.png#metis-image=fit;banner=fade";
  const appearance=parse(await call("create_note",{title:"Styled agent page",icon,cover,idempotencyKey:"gateway-appearance-create"})).note;
  assert.equal(appearance.icon,icon);assert.equal(appearance.cover,cover);
  assert.equal(appearance.projectId,projectId);assert.equal(appearance.author,"agent");
  const stored=modules[2].getNote(appearance.id,owner)!;
  assert.equal(stored.icon,icon);assert.equal(stored.cover,cover);
  assert.equal(modules[2].getNote(appearance.id,stranger),null);
  const disk=new DatabaseSync(path.join(root,"issues.sqlite"));
  try {
    const row=disk.prepare("SELECT data FROM notes WHERE id=?").get(appearance.id) as {data:string};
    assert.equal(JSON.parse(row.data).icon,icon);assert.equal(JSON.parse(row.data).cover,cover);
  } finally {disk.close();}
  const retry=parse(await call("create_note",{title:"Do not replace",icon:"❌",cover:null,idempotencyKey:"gateway-appearance-create"})).note;
  assert.equal(retry.id,appearance.id);assert.equal(retry.icon,icon);assert.equal(retry.cover,cover);
  const textEdit=parse(await call("update_note",{id:appearance.id,content:"Keep appearance",version:appearance.version,idempotencyKey:"gateway-appearance-text"})).note;
  assert.equal(textEdit.icon,icon);assert.equal(textEdit.cover,cover);
  const removed=parse(await call("update_note",{id:appearance.id,icon:null,cover:null,version:textEdit.version,idempotencyKey:"gateway-appearance-clear"})).note;
  assert.equal(removed.icon,null);assert.equal(removed.cover,null);
  assert.equal(removed.content,"Keep appearance");
  assert.equal((await call("create_note",{icon:{name:"book-open"},cover,idempotencyKey:"gateway-appearance-invalid-icon"})).isError,true);
  assert.equal((await call("create_note",{icon,cover:42,idempotencyKey:"gateway-appearance-invalid-cover"})).isError,true);
  const child=parse(await call("create_note",{title:"Gateway child page",projectId,parentId:page.id,sortKey:512,scope:"global",idempotencyKey:"gateway-child-create"})).note;
  assert.equal(child.parentId,page.id);
  const updatedPageResult=parse(await call("update_note",{id:child.id,parentId:null,sortKey:2048,icon:"📝",cover:null,fullWidth:false,favorite:false,version:child.version,idempotencyKey:"gateway-page-update"}));
  const updatedPage=updatedPageResult.note;
  assert.equal(updatedPageResult.noteLink,"note://"+child.id);
  assert.match(updatedPageResult.markdown,/^\[Gateway child page\]\(note:\/\//);
  assert.equal(updatedPage.parentId,null);assert.equal(updatedPage.sortKey,2048);assert.equal(updatedPage.icon,"📝");
  const noteList=parse(await call("list_notes",{scope:"global",projectId}));
  const linked=noteList.notes.find((note:{id:string})=>note.id===page.id);
  assert.equal(linked.noteLink,"note://"+page.id);
  assert.equal(linked.markdown,pageResult.markdown);
  assert.ok(intercepted.length>=8);assert.ok(intercepted.every(id=>id===job.id));
});

test("issue UI renders an accessible loading state and creation/list/board controls",async()=>{
  const React=await import("react");
  const {renderToStaticMarkup}=await import("react-dom/server");
  Object.assign(globalThis,{React});
  const require=createRequire(path.join(root,"render-test.cjs"));
  const previousCss=require.extensions[".css"];
  require.extensions[".css"]=()=>{};
  let IssuesView:typeof import("../components/notes/issues-view").IssuesView;
  try {({IssuesView}=await import("../components/notes/issues-view"));}
  finally {if(previousCss)require.extensions[".css"]=previousCss;else delete require.extensions[".css"];}
  const html=renderToStaticMarkup(React.createElement(IssuesView,{projectId:null}));
  assert.match(html,/Loading issues/);assert.match(html,/role="status"/);
  assert.match(html,/aria-label="List view"/);assert.match(html,/aria-label="Board view"/);
  assert.match(html,/aria-label="New issue title"/);assert.match(html,/Search issues/);assert.match(html,/>View</);
});

test("project deletion preserves complete issues privately without source collisions or former-member access",()=>{
  const [,projects,notes,sharing,sqlite,issues]=modules;
  const project=projects.createProject({ownerId:owner,name:"Remove this container"});
  sharing.respondProjectInvitation(sharing.inviteProjectMember(project.id,owner,"issue-member").id,member,"accept");
  const note=notes.createNote({ownerId:owner,projectId:project.id,title:"Retained source",content:"- [ ] Follow up"});
  const source={noteId:note.id,sourceId:"stable-checkbox",kind:"checkbox" as const,excerpt:"Follow up"};
  const parent=issues.createIssue(owner,{projectId:project.id,title:"Keep project work",description:"Keep this description",assigneeId:member,source},"delete-project-request");
  const child=issues.createIssue(member,{projectId:project.id,title:"Keep child work",parentId:parent.id,assigneeId:owner});
  issues.addIssueComment(parent.id,member,"Keep the discussion.");
  const relation=issues.addIssueRelation(parent.id,member,child.id,"blocks");
  // The same page may legitimately have an older private conversion after moving containers.
  notes.moveNote(note.id,{ownerId:owner,projectId:null});
  const existingPrivate=issues.createIssue(owner,{title:"Earlier private conversion",source});
  notes.moveNote(note.id,{ownerId:owner,projectId:project.id});
  issues.saveIssueSettings(owner,project.id,{layout:"board"});
  issues.saveIssueSettings(member,project.id,{layout:"board"});
  const privateSettings=issues.getIssueSettings(owner,null);
  assert.equal(projects.deleteProject(project.id,member),null);
  assert.equal(issues.getIssue(parent.id,owner)?.projectId,project.id);
  assert.ok(projects.deleteProject(project.id,owner));
  const detail=issues.getIssueDetail(parent.id,owner),preservedChild=issues.getIssue(child.id,owner)!;
  assert.equal(detail.issue.id,parent.id);assert.equal(detail.issue.key,parent.key);
  assert.equal(detail.issue.projectId,null);assert.equal(detail.issue.ownerId,owner);
  assert.equal(detail.issue.description,"Keep this description");assert.equal(detail.issue.assigneeId,null);
  assert.deepEqual(detail.issue.source,source);assert.equal(detail.issue.version,parent.version+1);
  assert.equal(detail.comments[0].body,"Keep the discussion.");assert.equal(detail.comments[0].authorId,member);
  assert.equal(detail.subissues[0].id,child.id);assert.equal(preservedChild.parentId,parent.id);
  assert.equal(preservedChild.assigneeId,owner);assert.equal(detail.relations[0].id,relation.id);
  assert.ok(detail.history.some(item=>item.action==="created"));
  assert.ok(detail.history.some(item=>item.action==="project_removed"&&item.changes.projectId.before===project.id&&item.changes.projectId.after===null));
  assert.ok(issues.listIssues(owner).some(issue=>issue.id===existingPrivate.id));
  assert.ok(issues.listIssues(owner).some(issue=>issue.id===parent.id));
  assert.equal(issues.getIssue(parent.id,member),null);assert.equal(issues.getIssue(child.id,member),null);
  assert.ok(!issues.listIssues(member).some(issue=>issue.id===parent.id));
  assert.throws(()=>issues.listIssues(owner,{projectId:project.id}),/not found/);
  assert.equal(issues.createIssue(owner,{title:"Retried after project deletion"},"delete-project-request").id,parent.id);
  assert.deepEqual(issues.getIssueSettings(owner,null),privateSettings);
  const db=sqlite.getDatabase();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM issues WHERE container_key=?").get("project:"+project.id) as {n:number}).n,0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM issue_view_settings WHERE container_key=?").get("project:"+project.id) as {n:number}).n,0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM issue_request_keys WHERE container_key=?").get("project:"+project.id) as {n:number}).n,0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("revoked membership blocks existing and newly requested issue data immediately",async()=>{
  const issues=modules[5];
  modules[3].removeProjectMember(projectId,owner,{userId:member});
  assert.equal(issues.getIssue(issueId,member),null);
  assert.throws(()=>issues.listIssues(member,{projectId}),/not found/);
  assert.throws(()=>issues.getIssueDetail(issueId,member),/not found/);
  assert.throws(()=>issues.addIssueComment(issueId,member,"After removal"),/not found/);
  assert.throws(()=>issues.updateIssue(issueId,member,{status:"done"}),/not found/);
  assert.throws(()=>issues.createIssue(member,{projectId,title:"After removal"}),/not found/);
  assert.throws(()=>issues.saveIssueSettings(member,projectId,{layout:"board"}),/not found/);
  assert.throws(()=>issues.updateIssue(issueId,owner,{assigneeId:member}),/member/);
  const route=await import("../app/api/issues/[id]/route");
  assert.equal((await route.GET(req("/api/issues/"+issueId,tokens.member),{params:Promise.resolve({id:issueId})})).status,404);
  assert.ok(issues.getIssue(issueId,owner));
});
