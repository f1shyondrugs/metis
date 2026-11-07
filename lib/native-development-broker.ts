import { createConnection } from "node:net";

/** Operator-configured local broker; never grants the web process setuid. */
export function callNativeDevelopmentBroker(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socket = process.env.METIS_DEVELOPMENT_BROKER;
  if (!socket) return Promise.reject(new Error("Development broker is not configured"));
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let output = "", settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return; settled = true; connection.destroy();
      if (error) reject(error); else resolve(value!);
    };
    connection.setTimeout(35_000, () => finish(new Error("Development broker timed out")));
    connection.once("error", error => finish(error));
    connection.once("connect", () => connection.write(JSON.stringify(request) + "\n"));
    connection.on("data", data => {
      output += data.toString();
      if (output.length > 8_000_000) return finish(new Error("Broker response too large"));
      if (!output.includes("\n")) return;
      try { finish(undefined, JSON.parse(output.slice(0, output.indexOf("\n")))); }
      catch { finish(new Error("Invalid development broker response")); }
    });
    connection.on("close", () => { if (!settled) finish(new Error("Development broker disconnected")); });
  });
}
