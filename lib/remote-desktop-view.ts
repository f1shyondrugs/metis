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

export function desktopMonitorLayout(monitors: DesktopMonitor[]) {
  if (!monitors.length) return null;
  const valid = monitors.every(monitor => [monitor.x, monitor.y, monitor.width, monitor.height].every(Number.isFinite)
    && monitor.width > 0 && monitor.height > 0);
  const overlaps = valid && monitors.some((monitor, index) => monitors.slice(index + 1).some(other =>
    monitor.x < other.x + other.width && other.x < monitor.x + monitor.width
    && monitor.y < other.y + other.height && other.y < monitor.y + monitor.height));
  if (valid && !overlaps) {
    const left = Math.min(...monitors.map(monitor => monitor.x));
    const top = Math.min(...monitors.map(monitor => monitor.y));
    const width = Math.max(...monitors.map(monitor => monitor.x + monitor.width)) - left;
    const height = Math.max(...monitors.map(monitor => monitor.y + monitor.height)) - top;
    return { mode: "arrangement" as const, width, height,
      tiles: monitors.map(monitor => ({ monitor, left: monitor.x - left, top: monitor.y - top, width: monitor.width, height: monitor.height })) };
  }
  const columns = Math.ceil(Math.sqrt(monitors.length));
  return { mode: "grid" as const, width: columns * 16, height: Math.ceil(monitors.length / columns) * 10,
    tiles: monitors.map((monitor, index) => ({ monitor, left: (index % columns) * 16, top: Math.floor(index / columns) * 10, width: 16, height: 10 })) };
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
