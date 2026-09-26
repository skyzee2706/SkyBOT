import { Router, type Response } from "express";
import { waitUntil } from "@vercel/functions";
import { db } from "../db.js";
import { xEnabled } from "../env.js";
import { recordTaskClick, refreshTaskMessage } from "../raffle/service.js";
import { verifyLinkToken, verifyTaskToken, xAccessToken, xAuthorizeUrl, xRequestToken } from "../x.js";
import { safeReturnPath } from "../../shared/raffle.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: Response, status: number, title: string, message: string) {
  res.status(status).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f4f4f5;font:16px system-ui,sans-serif;padding:16px}
.c{max-width:420px;text-align:center;border:1px solid #27272a;border-radius:16px;padding:32px;background:#18181b}
h1{font-size:22px;margin:0 0 12px}p{color:#a1a1aa;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${message}</p></div></body></html>`);
}

const EXPIRED = "Click <b>Connect X</b> or <b>Enter</b> again in Discord to get a new link.";

export const xRouter = Router();

// Dibuka dari link yang dikirim bot di Discord.
xRouter.get("/connect", async (req, res) => {
  if (!xEnabled) return page(res, 503, "X is not enabled yet", "The admin hasn't set X_API_KEY and X_API_SECRET.");
  const discordId = verifyLinkToken(String(req.query.t ?? ""));
  if (!discordId) return page(res, 400, "Link expired", EXPIRED);

  // Bersihkan sisa login lama yang tidak selesai
  await db.xAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3_600_000) } } });

  let token: string, secret: string;
  try {
    ({ token, secret } = await xRequestToken());
  } catch (e) {
    console.error("[x] request_token failed", e);
    return page(res, 502, "Couldn't connect to X", "Please try again in a moment. If it keeps failing, contact an admin.");
  }
  const returnTo = safeReturnPath(req.query.r);
  await db.xAuthState.create({ data: { oauthToken: token, tokenSecret: secret, discordId, returnTo } });
  res.redirect(xAuthorizeUrl(token));
});

xRouter.get("/callback", async (req, res) => {
  const { oauth_token, oauth_verifier, denied } = req.query as Record<string, string | undefined>;
  if (denied) {
    await db.xAuthState.deleteMany({ where: { oauthToken: denied } });
    return page(res, 400, "Cancelled", `You cancelled the X login. ${EXPIRED}`);
  }
  const state = oauth_token ? await db.xAuthState.findUnique({ where: { oauthToken: oauth_token } }) : null;
  if (!state || !oauth_verifier) return page(res, 400, "Link expired", EXPIRED);
  await db.xAuthState.delete({ where: { oauthToken: state.oauthToken } });

  let x: { userId: string; username: string };
  try {
    x = await xAccessToken(state.oauthToken, state.tokenSecret, oauth_verifier);
  } catch (e) {
    console.error("[x] access_token failed", e);
    return page(res, 502, "Couldn't connect to X", EXPIRED);
  }
  const taken = await db.xLink.findUnique({ where: { xUserId: x.userId } });
  if (taken && taken.discordId !== state.discordId) {
    const back = state.returnTo && safeReturnPath(state.returnTo) ? ` <a href="${state.returnTo}" style="color:#818cf8">Back to the raffle</a>` : "";
    return page(res, 409, "X account already in use", `<b>@${esc(x.username)}</b> is already connected to another Discord account.${back}`);
  }
  await db.xLink.upsert({
    where: { discordId: state.discordId },
    create: { discordId: state.discordId, xUserId: x.userId, xUsername: x.username },
    update: { xUserId: x.userId, xUsername: x.username, linkedAt: new Date() },
  });
  // Dari halaman web raffle: langsung kembali ke sana
  if (state.returnTo && safeReturnPath(state.returnTo)) return res.redirect(state.returnTo);
  page(
    res,
    200,
    "✅ X account connected",
    `<b>@${esc(x.username)}</b> is now connected. Close this page, go back to Discord and click <b>Enter</b>.`,
  );
});

// Tombol task di Discord mengarah ke sini: catat bahwa task sudah dibuka, lalu teruskan ke X.
xRouter.get("/task", async (req, res) => {
  const click = verifyTaskToken(String(req.query.t ?? ""));
  if (!click) return page(res, 400, "Link expired", "Click <b>Enter</b> on the raffle again in Discord to get new task buttons.");
  const url = await recordTaskClick(click);
  if (!url) return page(res, 404, "Task unavailable", "This raffle has ended or its tasks have changed.");
  res.redirect(url);
  waitUntil(refreshTaskMessage(click.raffleId, click.userId).catch((e) => console.error("[x] failed to update task message", e)));
});
