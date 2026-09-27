import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import express, { type Request, type Response } from "express";
import { db } from "../db.js";
import { env } from "../env.js";

// Batas body Vercel Function ±4,5 MB; gambar biasanya sudah dikompres jauh lebih kecil di browser.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DAILY_UPLOAD_LIMIT = 50;

// Tentukan jenis file dari isi byte-nya (bukan dari header yang bisa dipalsukan).
function sniffMime(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export const rawImageBody = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

// Dipasang di dashboardRouter (butuh login); pengecekan akses server dilakukan oleh pemanggil.
export async function saveImage(req: Request, guildId: string, uploaderId: string) {
  return storeImage(req.body, guildId, uploaderId);
}

async function storeImage(data: unknown, guildId: string, uploaderId: string): Promise<{ url: string } | { error: string }> {
  if (!Buffer.isBuffer(data) || data.length === 0) return { error: "No image received." };
  const mime = sniffMime(data);
  if (!mime) return { error: "Unsupported file. Use PNG, JPG, GIF or WebP." };

  const today = await db.image.count({
    where: { uploaderId, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
  });
  if (today >= DAILY_UPLOAD_LIMIT) return { error: `Upload limit reached (${DAILY_UPLOAD_LIMIT} images per day).` };

  const image = await db.image.create({
    data: { guildId, uploaderId, mime, size: data.length, data: new Uint8Array(data) },
    select: { id: true },
  });
  return { url: `${env.PUBLIC_URL}/api/images/${image.id}` };
}

// Publik (Discord perlu bisa mengambil gambarnya). Isi gambar tidak pernah berubah, jadi di-cache selamanya oleh CDN.
export async function serveImage(req: Request, res: Response) {
  const id = String(req.params.id).replace(/\.\w+$/, "");
  const image = await db.image.findUnique({ where: { id }, select: { mime: true, data: true } });
  if (!image) {
    res.status(404).send("Image not found");
    return;
  }
  res.setHeader("Content-Type", image.mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(Buffer.from(image.data));
}

export const isOwnImageUrl = (url: string) => url.startsWith(`${env.PUBLIC_URL}/api/images/`);

// Alamat IP internal (server sendiri, jaringan lokal, metadata cloud) tidak boleh diakses lewat "Paste link"
function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:") throw new Error("only https links are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("that address is not allowed");
}

// Gambar dari link (mode "Paste link") diunduh sekali lalu disimpan di SkyBOT, supaya:
// - server pemilik link tidak bisa mencatat IP pengunjung halaman raffle
// - gambar tidak hilang kalau link aslinya mati
export async function importImageFromUrl(raw: string, guildId: string, uploaderId: string): Promise<{ url: string } | { error: string }> {
  const failed = (why: string) => ({ error: `Couldn't use that image link (${why}). Upload the image file instead.` });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failed("invalid link");
  }
  try {
    let res: globalThis.Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublicHost(url);
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "image/*" } });
      const next = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && next) {
        url = new URL(next, url);
        res = null;
        continue;
      }
      break;
    }
    if (!res) return failed("too many redirects");
    if (!res.ok || !res.body) return failed(`the site answered ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return failed("larger than 4 MB");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) return failed("larger than 4 MB");
      chunks.push(Buffer.from(chunk));
    }
    return storeImage(Buffer.concat(chunks), guildId, uploaderId);
  } catch (e) {
    return failed((e as Error).name === "TimeoutError" ? "the site took too long" : (e as Error).message);
  }
}
