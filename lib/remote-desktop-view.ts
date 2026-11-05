import type { RemoteClient } from "@/lib/remote-clients";

export type DesktopMonitor = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
};

export function chooseDesktopMonitor(monitors: DesktopMonitor[], selectedId?: string | null) {
  return monitors.find(monitor => monitor.id === selectedId)
    ?? monitors.find(monitor => monitor.primary)
    ?? monitors[0] ?? null;
}

export function desktopMonitorLabel(monitor: DesktopMonitor) {
  return monitor.name + " · " + monitor.width + " × " + monitor.height + (monitor.primary ? " · Primary" : "");
}

export function desktopUnavailableReason(client: RemoteClient): string | null {
  if (client.status !== "online") return client.status === "revoked" ? "This device has been revoked." : "This device is offline. Start its Remote Client to view the desktop.";
  if (!client.capabilities.includes("desktop_gui")) return "No interactive desktop is available on this device.";
  if (!client.policy.permissions.includes("computer_use")) return "Desktop access is disabled for this device. Enable Computer Use in Remote Devices.";
  return null;
}

export function chooseDesktopClient(clients: RemoteClient[], selectedId: string | null, agentId?: string | null) {
  return clients.find(client => client.id === agentId)
    ?? clients.find(client => client.id === selectedId)
    ?? clients.find(client => desktopUnavailableReason(client) === null)
    ?? clients[0] ?? null;
}
