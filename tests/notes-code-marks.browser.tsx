import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NotesBlockEditor } from "@/components/notes/block-editor";
import { Markdown } from "@/components/markdown";

const source = "# Updater comparison\n\n| Option | Platform | Advantages | Effort | Choice |\n|---|---|---|---|---|\n| **`sample-updater` retained** | Desktop | Existing integration | Test restart | Keep |\n\nA [**`linked-code`**](https://example.com/docs) and *`italic-code`*.";
function Fixture() {
  const [value, setValue] = useState(source), [generation, setGeneration] = useState(0), [result, setResult] = useState("Running checks…");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const checks: string[] = [];
    const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); checks.push(label); };
    const until = async (fn: () => unknown) => { for (let n = 0; n < 150; n++) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); } throw Error("Editor mount timed out"); };
    const blocks = () => document.querySelector<HTMLElement>(".ProseMirror");
    const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("[data-editor] button"));
    void (async () => {
      let failure = "";
      try {
        await until(() => blocks()?.querySelector("table"));
        check(!document.querySelector("[role=alert]"), "Canvas editor opens without a content error");
        check(document.querySelectorAll("[data-preview] table").length === 1, "Chat preview renders one table");
        check(blocks()?.querySelectorAll("tr")[0].children.length === 5, "Canvas table retains five columns");
        check(Boolean(blocks()?.querySelector("strong code, code strong")), "Bold code survives editor mount");
        check(Boolean(blocks()?.querySelector("a code")), "Linked code survives editor mount");
        buttons().find(b => b.textContent?.trim() === "Markdown")!.click();
        await until(() => document.querySelector(".cm-editor"));
        check(!document.querySelector("[role=alert]"), "Source mode opens without an error");
        buttons().find(b => b.textContent?.trim() === "Blocks")!.click();
        await until(() => blocks()?.querySelector("table"));
        check(!document.querySelector("[role=alert]"), "Source to Blocks retains valid formatted code");
        setValue(source.replace("retained", "updated"));
        await until(() => blocks()?.textContent?.includes("updated"));
        check(!document.querySelector("[role=alert]"), "Controlled Markdown updates remain valid");
        setGeneration(1);
        await until(() => document.querySelector("[data-generation='1'] .ProseMirror table"));
        check(!document.querySelector("[role=alert]"), "Fresh editor remount accepts the saved source");
        check(document.querySelector("[data-saved]")?.textContent === source.replace("retained", "updated"), "Opening and mode changes preserve the exact saved Markdown");
      } catch (error) { failure = String(error); }
      const report = { checks, failure };
      setResult(JSON.stringify(report, null, 2));
      await fetch("/report", { method: "POST", body: JSON.stringify(report) });
    })();
  }, []);
  return <main style={{ padding: 20, maxWidth: 1100, margin: "auto" }}>
    <h1>Canvas formatted-code regression</h1>
    <section data-preview=""><h2>Chat preview</h2><Markdown content={value}/></section>
    <section data-editor="" data-generation={generation}><h2>Canvas editor</h2><NotesBlockEditor key={generation} value={value} onChange={setValue} workspace={{ chatId: "synthetic-chat", id: "synthetic-canvas", type: "canvas" }} hideAttachmentButton/></section>
    <pre data-saved="" style={{ display: "none" }}>{value}</pre>
    <details open><summary>Verification</summary><pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre></details>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
