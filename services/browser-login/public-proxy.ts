import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { isPrivateAddress } from "../../lib/url-security";

// Resolve in the proxy and connect to that exact IP. Chromium cannot turn a
// public DNS validation into a second private-network lookup (DNS rebinding).
export async function publicBrowserProxy() {
  const server = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  server.on("connect", (req, client, head) => {
    void (async () => {
      const target = new URL(`https://${req.url}`);
      if (target.port && target.port !== "443" || target.username || target.password) throw Error("Denied");
      const addresses = await dns.lookup(target.hostname, { all: true, family: 4 });
      if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw Error("Denied");
      const upstream = net.connect(443, addresses[0].address);
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.on("error", () => client.destroy()); client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client); client.pipe(upstream);
      });
    })().catch(() => client.destroy());
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address() as net.AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}
