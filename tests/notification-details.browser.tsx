import { createRoot } from "react-dom/client";
import { NotificationDeliverySettings } from "../components/notification-delivery-settings";
import { useNotificationSettings } from "../hooks/use-notification-settings";
import { normalizeNotificationPrefs } from "../lib/notification-preferences";

const report = window.fetch.bind(window);
let prefs = normalizeNotificationPrefs(undefined);
const patches: unknown[] = [];
window.fetch = async (input, options) => {
  if (input !== "/api/notifications") throw Error("Unexpected fixture request");
  if (options?.method === "PATCH") {
    const patch = JSON.parse(String(options.body));
    patches.push(patch);
    prefs = normalizeNotificationPrefs({...prefs, ...patch});
  }
  return Response.json({prefs, clients:[]});
};
function Fixture() {
  const settings = useNotificationSettings();
  return <main className="mx-auto w-full max-w-2xl px-4 py-6 text-foreground sm:px-8">
    <h2 className="text-sm font-medium">Notifications</h2>
    <p className="mt-1 mb-5 text-xs text-muted-foreground">Get notified when the agent needs input or finishes a response.</p>
    <NotificationDeliverySettings settings={settings} onOpenDevices={()=>{}}/>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
if (new URLSearchParams(location.search).has("verify")) {
  const results: string[] = [];
  const check = (pass:unknown, label:string) => results.push((pass ? "PASS " : "FAIL ")+label);
  const get = (id:string) => document.getElementById(id) as HTMLButtonElement;
  async function until(predicate: () => boolean) {
    for (let i=0; i<100; i++) {
      if (predicate()) return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw Error("Preference change did not settle");
  }
  async function run() {
    const title = () => get("notification-chat-title");
    const domain = () => get("notification-server-domain");
    const checked = (control:HTMLButtonElement) => control.getAttribute("aria-checked")==="true";
    await until(()=>Boolean(title() && !title().disabled));
    check(!checked(title()) && !checked(domain()),"both controls default off");
    check(title().labels?.[0]?.textContent==="Show chat title" && domain().labels?.[0]?.textContent==="Show server domain","both controls have associated labels");
    title().focus();
    title().click();
    await until(()=>checked(title()) && !domain().disabled);
    check(!checked(domain()),"title does not change the domain switch");
    domain().click();
    await until(()=>checked(domain()) && !title().disabled);
    check(checked(title()),"domain does not change the title switch");
    title().click();
    await until(()=>!checked(title()) && !domain().disabled);
    check(checked(domain()),"turning off title keeps the domain choice");
    check(JSON.stringify(patches)===JSON.stringify([{showChatTitle:true},{showServerDomain:true},{showChatTitle:false}]),"requests persist individual fields only");
    check(document.documentElement.scrollWidth<=innerWidth,"no horizontal scroll");
  }
  void run().catch(error=>results.push("FAIL "+String(error))).finally(async()=>{
    document.body.dataset.done="true";
    await report("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});
  });
}
