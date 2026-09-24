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
  const data = req.body;
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
