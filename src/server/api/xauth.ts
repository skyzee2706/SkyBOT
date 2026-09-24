import { Router, type Response } from "express";
import { db } from "../db.js";
import { xEnabled } from "../env.js";
import { verifyLinkToken, xAccessToken, xAuthorizeUrl, xRequestToken } from "../x.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: Response, status: number, title: string, message: string) {
  res.status(status).type("html").send(`<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f4f4f5;font:16px system-ui,sans-serif;padding:16px}
.c{max-width:420px;text-align:center;border:1px solid #27272a;border-radius:16px;padding:32px;background:#18181b}
h1{font-size:22px;margin:0 0 12px}p{color:#a1a1aa;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${message}</p></div></body></html>`);
}

export const xRouter = Router();

// Dibuka dari link yang dikirim bot di Discord.
xRouter.get("/connect", async (req, res) => {
  if (!xEnabled) return page(res, 503, "Fitur X belum aktif", "Admin belum mengisi X_API_KEY dan X_API_SECRET.");
  const discordId = verifyLinkToken(String(req.query.t ?? ""));
  if (!discordId) {
    return page(res, 400, "Link kedaluwarsa", "Klik tombol <b>Enter</b> lagi di Discord untuk mendapatkan link baru.");
  }
  // Bersihkan sisa login lama yang tidak selesai
  await db.xAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3_600_000) } } });

  let token: string, secret: string;
  try {
    ({ token, secret } = await xRequestToken());
  } catch (e) {
    console.error("[x] request_token gagal", e);
    return page(res, 502, "Gagal terhubung ke X", "Coba lagi beberapa saat. Kalau masih gagal, kabari admin.");
  }
  await db.xAuthState.create({ data: { oauthToken: token, tokenSecret: secret, discordId } });
  res.redirect(xAuthorizeUrl(token));
});

xRouter.get("/callback", async (req, res) => {
  const { oauth_token, oauth_verifier, denied } = req.query as Record<string, string | undefined>;
  if (denied) {
    await db.xAuthState.deleteMany({ where: { oauthToken: denied } });
    return page(res, 400, "Dibatalkan", "Kamu membatalkan login X. Klik <b>Enter</b> lagi di Discord untuk mencoba ulang.");
  }
  const state = oauth_token ? await db.xAuthState.findUnique({ where: { oauthToken: oauth_token } }) : null;
  if (!state || !oauth_verifier) {
    return page(res, 400, "Link kedaluwarsa", "Klik tombol <b>Enter</b> lagi di Discord untuk mendapatkan link baru.");
  }
  await db.xAuthState.delete({ where: { oauthToken: state.oauthToken } });

  let x: { userId: string; username: string };
  try {
    x = await xAccessToken(state.oauthToken, state.tokenSecret, oauth_verifier);
  } catch (e) {
    console.error("[x] access_token gagal", e);
    return page(res, 502, "Gagal terhubung ke X", "Klik <b>Enter</b> lagi di Discord untuk mencoba ulang.");
  }
  const taken = await db.xLink.findUnique({ where: { xUserId: x.userId } });
  if (taken && taken.discordId !== state.discordId) {
    return page(res, 409, "Akun X sudah dipakai", `Akun X <b>@${esc(x.username)}</b> sudah terhubung ke akun Discord lain.`);
  }
  await db.xLink.upsert({
    where: { discordId: state.discordId },
    create: { discordId: state.discordId, xUserId: x.userId, xUsername: x.username },
    update: { xUserId: x.userId, xUsername: x.username, linkedAt: new Date() },
  });
  page(
    res,
    200,
    "✅ Akun X terhubung",
    `Akun <b>@${esc(x.username)}</b> sudah terhubung. Tutup halaman ini, kembali ke Discord, lalu klik <b>Enter</b> lagi.`,
  );
});
