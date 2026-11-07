/** Bundle with the pinned esbuild toolchain and open through Metis browser tools.
 * Uses only an isolated fixture origin. No app sessions, provider calls or real user data.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { HtmlEmbed } from "../components/html-embed";

const results: string[] = [];
const report = document.createElement("pre");
report.id = "html-test-results";
document.body.append(report);
const host = document.createElement("main");
document.body.append(host);
document.documentElement.style.cssText = "--background:#121212;--foreground:#f4f4f4;--muted:#202020;--muted-foreground:#aaa;--border:#393939;--primary:#82b4ff;--primary-foreground:#111";
document.cookie = "html_fixture_sentinel=parent-only; SameSite=Lax";
localStorage.setItem("html_fixture_sentinel", "parent-only");
let initialHeight = 0, version = 0;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, label: string) {
  results.push((value ? "PASS " : "FAIL ") + label);
  report.textContent = results.join("\n");
  if (!value) document.body.dataset.failed = "true";
}
window.addEventListener("message", async event => {
  const frame = host.querySelector("iframe");
  if (!frame || event.source !== frame.contentWindow || event.origin !== "null") return;
  const data = event.data;
  if (data?.type === "fixture-diagnostics") {
    const current = ++version;
    await pause(180);
    if (current !== version) return;
    check(data.parentBlocked, "parent DOM is inaccessible");
    check(data.cookieBlocked, "parent cookies are inaccessible");
    check(data.storageBlocked, "parent storage is inaccessible");
    check(data.fetchBlocked, "network fetch is blocked");
    check(data.themed, "theme colors reach the widget");
    initialHeight = parseFloat(frame.style.height);
    check(initialHeight >= 96 && initialHeight < 240, "frame fits the content height");
    const id = JSON.parse(frame.srcdoc.split("const id=")[1].split(";let")[0]);
    window.dispatchEvent(new MessageEvent("message", { origin: "null", source: window, data: { type: "metis-html-size", id, height: 999999 } }));
    await pause(40);
    check(parseFloat(frame.style.height) === initialHeight, "a foreign source cannot resize the frame");
    void fetch("/result", { method: "POST", body: JSON.stringify({ results, complete: false }) });
  } else if (data?.type === "fixture-interaction") {
    await pause(120);
    check(data.completed, "the widget button handles local interaction");
    check(parseFloat(frame.style.height) > initialHeight, "the frame grows when content expands");
    document.body.dataset.complete = "true";
    void fetch("/result", { method: "POST", body: JSON.stringify({ results, complete: true }) });
  }
});
const source = [
  '<section style="padding:20px"><p style="margin:0 0 8px;color:var(--muted-foreground)">YOUR SMALL WIN</p><h2 style="margin:0 0 16px">One step at a time.</h2>',
  '<button id="complete" style="padding:10px 16px;border:0;border-radius:8px;background:var(--primary);color:var(--primary-foreground)">Mark complete</button>',
  '<div id="extra" hidden style="height:180px;padding-top:24px">Completed. Take a short break.</div></section>',
  "<script>",
  "document.getElementById('complete').onclick=()=>{document.getElementById('complete').textContent='Completed';document.getElementById('extra').hidden=false;parent.postMessage({type:'fixture-interaction',completed:true},'*')};",
  "async function inspect(){let parentBlocked=false,cookieBlocked=false,storageBlocked=false,fetchBlocked=false;try{parent.document.body}catch{parentBlocked=true}try{cookieBlocked=!document.cookie.includes('parent-only')}catch{cookieBlocked=true}try{localStorage.getItem('html_fixture_sentinel')}catch{storageBlocked=true}try{await fetch('http://127.0.0.1:3219/offline-probe')}catch{fetchBlocked=true}const themed=getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()==='#82b4ff';parent.postMessage({type:'fixture-diagnostics',parentBlocked,cookieBlocked,storageBlocked,fetchBlocked,themed},'*')};inspect();",
  "</script>",
].join("\n");
createRoot(host).render(<HtmlEmbed source={source} />);
setTimeout(() => { if (!document.body.dataset.complete) report.textContent += "\nWAITING_FOR_WIDGET_BUTTON"; }, 1000);
