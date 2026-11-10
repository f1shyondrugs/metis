// Bundle for the native Electron fixture: actual component and actual IPC.
// Account APIs are supplied by the fixture server on the same machine.
import React from "react";
import {createRoot} from "react-dom/client";
import {DesktopAssistant} from "../components/desktop-assistant";
createRoot(document.getElementById("root")!).render(<DesktopAssistant/>);
