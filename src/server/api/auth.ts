import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "../db.js";
import { env, OAUTH_REDIRECT } from "../env.js";

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_DAYS = 7;
const secure = env.PUBLIC_URL.startsWith("https://");

export type AuthUser = { id: string; username: string; avatar: string | null; accessToken: string };

// Cache sesi di memori supaya tiap request tidak selalu query database.
const sessionCache = new Map<string, { user: AuthUser; expiresAt: number; cachedAt: number }>();

export async function discordUserApi<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw Object.assign(new Error(`Discord API ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

export const authRouter = Router();

authRouter.get("/login", (_req, res) => {
  const state = randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { httpOnly: true, sameSite: "lax", secure, maxAge: 10 * 60_000 });
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT,
    response_type: "code",
    scope: "identify guilds",
    state,
    prompt: "none",
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

authRouter.get("/callback", async (req, res) => {
  const { code, state } = req.query as Record<string, string | undefined>;
  if (!code || !state || state !== req.cookies.oauth_state) {
    res.status(400).send("Login failed (state mismatch). <a href='/'>Try again</a>");
    return;
  }
  res.clearCookie("oauth_state");

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: OAUTH_REDIRECT,
    }),
  });
  if (!tokenRes.ok) {
    console.error("[auth] token exchange failed", tokenRes.status, await tokenRes.text());
    res.status(400).send("Login failed. Check DISCORD_CLIENT_SECRET and the Redirect URL. <a href='/'>Back</a>");
    return;
  }
  const token = (await tokenRes.json()) as { access_token: string; expires_in: number };
  const u = await discordUserApi<{ id: string; username: string; global_name: string | null; avatar: string | null }>(
    "/users/@me",
    token.access_token,
  );

  const username = u.global_name ?? u.username;
  await db.user.upsert({
    where: { id: u.id },
    create: { id: u.id, username, avatar: u.avatar },
    update: { username, avatar: u.avatar },
  });

  const sid = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + Math.min(SESSION_DAYS * 86_400, token.expires_in) * 1000);
  await db.session.create({ data: { id: sid, userId: u.id, accessToken: token.access_token, expiresAt } });

  res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", secure, expires: expiresAt });
  res.redirect("/");
});

authRouter.post("/logout", async (req, res) => {
  const sid = req.cookies.sid as string | undefined;
  if (sid) {
    sessionCache.delete(sid);
    await db.session.deleteMany({ where: { id: sid } });
  }
  res.clearCookie("sid");
  res.json({ ok: true });
});

async function loadSession(sid: string): Promise<AuthUser | null> {
  const cached = sessionCache.get(sid);
  if (cached && cached.expiresAt > Date.now() && Date.now() - cached.cachedAt < 5 * 60_000) return cached.user;

  const s = await db.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!s || s.expiresAt.getTime() < Date.now()) {
    sessionCache.delete(sid);
    return null;
  }
  const user = { id: s.user.id, username: s.user.username, avatar: s.user.avatar, accessToken: s.accessToken };
  sessionCache.set(sid, { user, expiresAt: s.expiresAt.getTime(), cachedAt: Date.now() });
  return user;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies.sid as string | undefined;
  const user = sid ? await loadSession(sid) : null;
  if (!user) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  res.locals.user = user;
  next();
}
