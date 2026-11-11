import React from "react";
import { createRoot } from "react-dom/client";
import { McpEnvEditor } from "../components/mcp-env-editor";
window.fetch = async () => Response.json({ revision: "0".repeat(64), keys: [{ key: "API_TOKEN", configured: true }, { key: "SERVICE_REGION", configured: true }] });
document.documentElement.classList.add("dark");
document.body.className = "bg-background text-foreground";
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-3xl p-5"><h1 className="text-xl font-semibold">Connection settings</h1><McpEnvEditor serverId="fixture" /></main>);
