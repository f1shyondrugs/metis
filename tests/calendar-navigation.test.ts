import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {calendarNavigationHarnessSource} from "./calendar-navigation-harness.mjs";
import {METIS_SHARED_AGENT_CONTROL} from "../lib/agent-control";
const source=fs.readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
function harness(initial="/?c=calendar"){
 const history=[new URL(initial,"https://fixture")];let index=0;
 const window={get location(){return history[index];},history:{
  pushState(_state:unknown,_title:string,url:string){history.splice(index+1);history.push(new URL(url,"https://fixture"));index++;},
  replaceState(_state:unknown,_title:string,url:string){history[index]=new URL(url,"https://fixture");},
 }};
 const create=vm.runInNewContext(calendarNavigationHarnessSource()+";createCalendarNavigationHarness",{URLSearchParams});
 const h=create(window);h.reconcile();
 return {h,url:()=>window.location.search,back(){index=Math.max(0,index-1);h.reconcile();},forward(){index=Math.min(history.length-1,index+1);h.reconcile();}};
}
test("calendar direct link and reload derive the primary workspace from the URL, not account state",()=>{
 for(let reload=0;reload<2;reload++){
  const {h,url}=harness();
  assert.equal(h.calendarOpen,true);assert.equal(h.state.accountView,null);assert.equal(url(),"?c=calendar");
  assert.equal(h.chatId,"fixture-chat","keep the last chat and its snapshot available");
  assert.equal(h.state.loads.length,0,"never load the reserved calendar route as a chat");
  for(const key of ["notesOpen","automationsOpen","workspaceOpen","mobileNavOpen"])assert.equal(h.state[key],false);
 }
});
test("real calendar, notes and automations callbacks cooperate with route reconciliation and history",()=>{
 const {h,url,back,forward}=harness("/?c=fixture-chat");
 h.openCalendar();assert.equal(url(),"?c=calendar");assert.equal(h.calendarOpen,true);assert.equal(h.state.accountView,null);
 h.openNotes();assert.equal(url(),"?c=notes");assert.equal(h.calendarOpen,false);assert.equal(h.state.notesOpen,true);
 back();assert.equal(url(),"?c=calendar");assert.equal(h.calendarOpen,true);assert.equal(h.state.notesOpen,false);
 forward();assert.equal(url(),"?c=notes");assert.equal(h.calendarOpen,false);
 h.openAutomations();assert.equal(h.calendarOpen,false);assert.equal(h.state.automationsOpen,true);
 h.openCalendar();assert.equal(h.calendarOpen,true);assert.equal(h.state.automationsOpen,false);
 assert.ok(!h.state.loads.includes("calendar"));
});
test("calendar to the same chat, another chat and new draft retains correct destinations",()=>{
 const {h,url}=harness();
 h.openChat("fixture-chat");assert.equal(url(),"?c=fixture-chat");assert.equal(h.calendarOpen,false);assert.equal(h.state.loads.length,0);
 h.openCalendar();h.openChat("another-chat");assert.equal(h.chatId,"another-chat");assert.equal(h.calendarOpen,false);
 h.openCalendar();h.openDraft();assert.equal(url(),"");assert.equal(h.calendarOpen,false);assert.equal(h.chatId,null);
});
test("calendar remains outside account pages and preserves native policy and sidebar order",()=>{
 const account=fs.readFileSync(new URL("../components/account/account-panel.tsx",import.meta.url),"utf8");
 assert.ok(!account.includes('"calendar"'));
 assert.ok(source.includes("</AccountPanel> : calendarOpen ? <CalendarWorkspace"));
 assert.ok(source.indexOf(">Notebooks</span>")<source.indexOf(">Calendar</span>"));
 assert.ok(source.indexOf(">Calendar</span>")<source.indexOf(">Automations</span>"));
 assert.ok(METIS_SHARED_AGENT_CONTROL.includes("Native calendar:"));
 assert.ok(METIS_SHARED_AGENT_CONTROL.includes("not proof that remote synchronization finished"));
});
