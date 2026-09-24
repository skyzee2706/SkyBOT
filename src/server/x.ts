import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// Login X memakai OAuth 1.0a: username & ID akun X sudah dikirim saat tukar token,
// jadi tidak perlu memanggil endpoint API X yang berbayar.
const X_OAUTH = "https://api.x.com/oauth";
export const X_CALLBACK = `${env.PUBLIC_URL}/api/x/callback`;

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
) {
  const paramString = Object.keys(params)
    .map((k) => [enc(k), enc(params[k])])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  return createHmac("sha1", `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest("base64");
}

async function signedPost(url: string, extra: Record<string, string>, tokenSecret = "") {
  const params: Record<string, string> = {
    oauth_consumer_key: env.X_API_KEY!,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...extra,
  };
  params.oauth_signature = oauthSignature("POST", url, params, env.X_API_SECRET!, tokenSecret);

  const header = "OAuth " + Object.keys(params).sort().map((k) => `${enc(k)}="${enc(params[k])}"`).join(", ");
  const res = await fetch(url, { method: "POST", headers: { Authorization: header } });
  const text = await res.text();
  if (!res.ok) throw new Error(`X OAuth ${res.status}: ${text.slice(0, 300)}`);
  return new URLSearchParams(text);
}

export async function xRequestToken() {
  const r = await signedPost(`${X_OAUTH}/request_token`, { oauth_callback: X_CALLBACK });
  if (r.get("oauth_callback_confirmed") !== "true") throw new Error("X menolak callback URL");
  return { token: r.get("oauth_token")!, secret: r.get("oauth_token_secret")! };
}

export const xAuthorizeUrl = (token: string) => `${X_OAUTH}/authenticate?oauth_token=${enc(token)}`;

export async function xAccessToken(token: string, tokenSecret: string, verifier: string) {
  const r = await signedPost(`${X_OAUTH}/access_token`, { oauth_token: token, oauth_verifier: verifier }, tokenSecret);
  return { userId: r.get("user_id")!, username: r.get("screen_name")! };
}

// Link "Hubungkan X" yang dikirim bot (ephemeral) berisi token bertanda tangan,
// supaya peserta tidak perlu login Discord di web dan orang lain tidak bisa memalsukannya.
const LINK_TTL_MS = 30 * 60_000;
const linkKey = createHmac("sha256", env.DISCORD_CLIENT_SECRET).update("x-link").digest();

export function createLinkToken(discordId: string) {
  const payload = `${discordId}.${Date.now() + LINK_TTL_MS}`;
  const sig = createHmac("sha256", linkKey).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyLinkToken(token: string): string | null {
  const [discordId, exp, sig] = token.split(".");
  if (!discordId || !exp || !sig) return null;
  const expected = createHmac("sha256", linkKey).update(`${discordId}.${exp}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Number(exp) > Date.now() ? discordId : null;
}

export const connectXUrl = (discordId: string) =>
  `${env.PUBLIC_URL}/api/x/connect?t=${encodeURIComponent(createLinkToken(discordId))}`;

// Link "intent" X: membuka X dengan aksi siap dikonfirmasi oleh peserta sendiri (gratis, sesuai aturan X).
export const intentFollow = (username: string) => `https://x.com/intent/follow?screen_name=${enc(username)}`;
export const intentLike = (tweetId: string) => `https://x.com/intent/like?tweet_id=${tweetId}`;
export const intentRetweet = (tweetId: string) => `https://x.com/intent/retweet?tweet_id=${tweetId}`;
export const tweetUrl = (tweetId: string) => `https://x.com/i/status/${tweetId}`;
