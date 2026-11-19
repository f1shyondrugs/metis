import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
import { getUpdateSchedule, isUpdateScheduleTime, nextUpdateAt, saveUpdateSchedule } from "@/lib/update-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function admin(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) return Response.json({ error: "Only host administrators can configure automatic updates." }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;
  const schedule = getUpdateSchedule();
  return Response.json({ schedule, nextRunAt: schedule.enabled ? nextUpdateAt(schedule) : null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid update schedule." }, { status: 400 });
  }
  const { enabled, time, timezone: rawTimezone } = body as { enabled?: unknown; time?: unknown; timezone?: unknown };
  if (enabled === undefined && time === undefined && rawTimezone === undefined) {
    return Response.json({ error: "No update schedule changes were provided." }, { status: 400 });
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return Response.json({ error: "Invalid automatic update status." }, { status: 400 });
  }
  if (time !== undefined && !isUpdateScheduleTime(time)) {
    return Response.json({ error: "Enter a valid time in HH:MM format." }, { status: 400 });
  }
  let timezone: string | undefined;
  if (rawTimezone !== undefined) {
    timezone = typeof rawTimezone === "string" ? rawTimezone.trim() : "";
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      return Response.json({ error: "Enter a valid timezone, such as Europe/Berlin." }, { status: 400 });
    }
  }
  const schedule = saveUpdateSchedule({ enabled, time, timezone });
  return Response.json({ schedule, nextRunAt: schedule.enabled ? nextUpdateAt(schedule) : null });
}
