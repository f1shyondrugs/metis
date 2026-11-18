import test from "node:test";import assert from "node:assert/strict";import {normalizeNotificationPrefs,remoteNotificationAllowed} from "../lib/notification-preferences";
test("fresh defaults and legacy selection preserve explicit choices",()=>{
 assert.deepEqual(normalizeNotificationPrefs(undefined),{toastEnabled:true,browserEnabled:false,remoteEnabled:true,agentFinishedEnabled:true,showChatTitle:false,showServerDomain:false,remoteClientIds:[]});
 const legacy=normalizeNotificationPrefs({browserEnabled:true,remoteClientIds:["pc","pc",null]});assert.equal(legacy.browserEnabled,false);assert.equal(legacy.remoteEnabled,true);assert.deepEqual(legacy.remoteClientIds,["pc"]);
 const disabled=normalizeNotificationPrefs({...legacy,remoteEnabled:false});assert.equal(remoteNotificationAllowed(disabled,false,"pc"),false);assert.deepEqual(disabled.remoteClientIds,["pc"]);
});
test("chat title and server domain are independent opt-ins, including for legacy or invalid data",()=>{
 const legacy=normalizeNotificationPrefs({remoteEnabled:true,showChatTitle:"true",showServerDomain:1});
 assert.equal(legacy.showChatTitle,false);assert.equal(legacy.showServerDomain,false);
 assert.deepEqual([normalizeNotificationPrefs({showChatTitle:true}).showChatTitle,normalizeNotificationPrefs({showChatTitle:true}).showServerDomain],[true,false]);
 assert.deepEqual([normalizeNotificationPrefs({showServerDomain:true}).showChatTitle,normalizeNotificationPrefs({showServerDomain:true}).showServerDomain],[false,true]);
});
test("completion mute keeps custom alerts and device selection remains authoritative",()=>{
 const prefs=normalizeNotificationPrefs({remoteEnabled:true,agentFinishedEnabled:false,remoteClientIds:["pc"]});
 assert.equal(remoteNotificationAllowed(prefs,true,"pc"),false);assert.equal(remoteNotificationAllowed(prefs,false,"pc"),true);assert.equal(remoteNotificationAllowed(prefs,false,"foreign"),false);
});
