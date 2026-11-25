import { NextResponse } from "next/server";
import { authenticateUser, CHAT_COOKIE, getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { patchManagedUser } from "@/lib/admin-users";
import { bootstrapSetupAccount, SetupBootstrapError, getSetupStatus, markSetupComplete } from "@/lib/setup";
import { isHostAdmin, inferOsUsernameForWorkspace, listHostOsUsers } from "@/lib/user-access";
import { hostPlatform } from "@/lib/user-isolation";
import { config } from "@/lib/config";
import { checkEditedPublicBaseUrl, checkPublicBaseUrl } from "@/lib/public-base-check";
import { getPublicBaseUrl, saveVerifiedPublicBaseUrl } from "@/lib/public-base-settings";
import { resolvePublicBaseUrl } from "@/lib/public-base-url";
import { requestIsSecure, requestOriginAllowed } from "@/lib/request-network";
import { consumeRateLimit } from "@/lib/rate-limit";
import { setupTokenConsumed, validSetupToken } from "@/lib/setup-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionCookie(res: NextResponse, token: string, maxAge: number, req: Request) {
  res.cookies.set(CHAT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(req),
    path: "/",
    maxAge,
  });
  return res;
}

function osUserSuggestions() {
  const osUsers = listHostOsUsers().map(({ username, home }) => ({ username, home }));
  const inferred = inferOsUsernameForWorkspace(config.agentCwd);
  return {
    osUsers,
    suggestedOsUsername: osUsers.some(user => user.username === inferred) ? inferred : "",
    osUsersAvailable: true,
  };
}

export async function GET(req: Request) {
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const status = getSetupStatus(ownerId);
  const canListOsUsers = Boolean(ownerId && isHostAdmin(ownerId));
  return Response.json({
    ...status,
    platform: hostPlatform(),
    ...(canListOsUsers ? osUserSuggestions() : { osUsers: [], suggestedOsUsername: "", osUsersAvailable: false }),
  });
}

export async function POST(req: Request) {
  const parsed: unknown = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Response.json({ error: "Invalid setup request." }, { status: 400 });
  }
  const body = parsed as {
    setupToken?: unknown;
    action?: string;
    username?: string;
    password?: string;
    osUsername?: unknown;
    publicUrl?: unknown;
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid setup request" }, { status: 400 });
  }
  const action = body.action || "";

  if (action === "check-public-url") {
    if (!requestOriginAllowed(req)) return Response.json({ error: "Invalid origin." }, { status: 403 });
    const userId = await getAuthenticatedUserId(req);
    const editing = "publicUrl" in body;
    if (editing && (!userId || !isHostAdmin(userId) || !getSetupStatus().needed)) {
      return Response.json({ error: "The setup administrator must be signed in and setup must still be open." }, { status: 403 });
    }
    const allowed = userId
      ? isHostAdmin(userId)
      : !getSetupStatus().hasUsers && validSetupToken(body.setupToken);
    if (!allowed) return Response.json({ error: "A valid operator setup token or host admin session is required." }, { status: 403 });
    const limit = consumeRateLimit("setup:check-public-url", 10, 60_000);
    if (!limit.allowed) return Response.json({ error: "Too many URL checks. Wait a minute and try again." }, {
      status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
    if (editing && typeof body.publicUrl !== "string") {
      return Response.json({ error: "Enter an HTTP or HTTPS address." }, { status: 400 });
    }
    const base = typeof body.publicUrl === "string" ? resolvePublicBaseUrl(body.publicUrl) : getPublicBaseUrl();
    const fallback = config.publicBaseUrl;
    const operatorDefault = "url" in base && "url" in fallback && base.url === fallback.url;
    const check = !("url" in base) || operatorDefault
      ? await checkPublicBaseUrl(base)
      : await checkEditedPublicBaseUrl(base);
    if (editing && check.state === "verified" && "url" in base && base.state === "configured") {
      if (!getSetupStatus().needed) return Response.json({ error: "Setup is already complete." }, { status: 409 });
      saveVerifiedPublicBaseUrl(base);
    }
    return Response.json({ check, ...(editing && check.state === "verified" ? { base } : {}) },
      { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "check-token" || action === "os-users") {
    if (action === "check-token" && !requestOriginAllowed(req)) {
      return Response.json({ error: "Invalid origin." }, { status: 403 });
    }
    const limit = consumeRateLimit(`setup:${action}`, 20, 60_000);
    if (!limit.allowed) return Response.json({ error: "Too many setup attempts." }, {
      status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
    if (getSetupStatus().hasUsers || setupTokenConsumed()) {
      return Response.json({ error: action === "check-token"
        ? "Setup already has an account or its token has been consumed."
        : "Sign in as an admin to list OS users." }, { status: 409 });
    }
    if (!validSetupToken(body.setupToken)) {
      return Response.json({ error: "A valid operator setup token is required." }, { status: 403 });
    }
    if (action === "check-token") {
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ platform: hostPlatform(), ...osUserSuggestions() });
  }

  if (action === "bootstrap") {
    // Global bucket: spoofed proxy/address headers cannot bypass this limiter.
    const limit = consumeRateLimit("setup:bootstrap", 10, 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "Too many setup attempts." }, {
        status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    try {
      const user = bootstrapSetupAccount({
        setupToken: body.setupToken,
        username: typeof body.username === "string" ? body.username : "",
        password: typeof body.password === "string" ? body.password : "",
        osUsername: body.osUsername,
      });
      const session = authenticateUser(user.username, body.password || "");
      if (!session) return Response.json({ error: "Could not sign in after setup." }, { status: 500 });
      const res = NextResponse.json({ ok: true, user, ...getSetupStatus(user.id) }, { status: 201 });
      return sessionCookie(res, session.token, session.maxAge, req);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create account.";
      return Response.json({ error: cause instanceof SetupBootstrapError ? message : "Could not create account." }, { status: cause instanceof SetupBootstrapError ? cause.status : 400 });
    }
  }

  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);
  if (!userId || !isHostAdmin(userId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "os-user") {
    if (body.osUsername != null && typeof body.osUsername !== "string") {
      return Response.json({ error: "Enter a server OS username." }, { status: 400 });
    }
    try {
      patchManagedUser(userId, {
        osUsername: body.osUsername ?? null,
        actorUserId: userId,
      });
      return Response.json({ ok: true, ...getSetupStatus(userId) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not bind OS user.";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  if (action === "complete") {
    markSetupComplete();
    return Response.json({ ok: true, ...getSetupStatus(userId) });
  }

  return Response.json({ error: "Unknown setup action." }, { status: 400 });
}
