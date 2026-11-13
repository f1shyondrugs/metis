import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {suggestedAppPlatform,onboardingStorageKey,parseOnboardingState,PRODUCT_TOUR} from "../lib/client-onboarding";
test("OS suggestions handle desktop, mobile and iPad desktop-mode without claiming architecture",()=>{
 for(const [input,expected] of [
  [{platform:"Win32",userAgent:"Mozilla Windows NT 10.0"},"windows"],
  [{platform:"MacIntel",maxTouchPoints:0},"macos"],
  [{platform:"Linux x86_64"},"linux"],
  [{platform:"Linux armv8",userAgent:"Mozilla Android 15"},"android"],
  [{platform:"MacIntel",maxTouchPoints:5,userAgent:"Mozilla Macintosh"},"ios"],
  [{userAgent:"Mozilla iPhone"},"ios"],[{platform:"Unknown"} ,null],
 ] as const)assert.equal(suggestedAppPlatform(input),expected);
});
test("completion is scoped to an account and client, not a global legacy flag",()=>{
 assert.notEqual(onboardingStorageKey("alice"),onboardingStorageKey("bob"));
 assert.notEqual(onboardingStorageKey("alice","desktop:one"),onboardingStorageKey("alice","desktop:two"));
 assert.notEqual(onboardingStorageKey("alice","desktop:one"),onboardingStorageKey("alice"));
 assert.notEqual(onboardingStorageKey("a:b","c"),onboardingStorageKey("a","b:c"));
});
test("resume records accept only current bounded steps and do not persist credentials",()=>{
 for(const phase of ["welcome","app","device","done"])assert.equal(parseOnboardingState(JSON.stringify({version:1,phase,tourIndex:2})).phase,phase);
 for(const raw of [null,"broken","null",'{"version":2,"phase":"done","tourIndex":0}','{"version":1,"phase":"tour","tourIndex":999}','{"version":1,"phase":"tour","tourIndex":-1}'])assert.equal(parseOnboardingState(raw).phase,"welcome");
 assert.equal(PRODUCT_TOUR.length,6); // Bounds for legacy v1 records only.
 for(let tourIndex=0;tourIndex<6;tourIndex++)assert.deepEqual(parseOnboardingState(JSON.stringify({version:1,phase:"tour",tourIndex})),{version:1,phase:"done",tourIndex:0});
 assert.deepEqual(Object.keys(parseOnboardingState(JSON.stringify({version:1,phase:"done",tourIndex:0,password:"discard"}))).sort(),["phase","tourIndex","version"]);
});
test("production wiring uses authenticated stable user ID and native bridge, not UA app branding",()=>{
 const status=readFileSync(new URL("../app/api/status/route.ts",import.meta.url),"utf8");
 const shell=readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
 const client=readFileSync(new URL("../components/client-onboarding.tsx",import.meta.url),"utf8");
 assert.match(status,/userId: user\?\.id/);assert.match(shell,/<ClientOnboarding key={status.userId}/);
 assert.match(client,/desktopBridge\(\)/);assert.doesNotMatch(client,/metis-onboarding-completed/);
 assert.match(client,/onboardingStorageKey\(userId,id\)/);
});
