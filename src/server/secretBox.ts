import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env.js";

// Enkripsi data sensitif yang disimpan di database (mis. access token Discord), AES-256-GCM.
// Kuncinya diturunkan dari DISCORD_CLIENT_SECRET, jadi database yang bocor saja tidak cukup untuk membacanya.
const key = createHash("sha256").update(`skybot:secret-box:${env.DISCORD_CLIENT_SECRET}`).digest();
const PREFIX = "v1:";

export function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

// null = tidak bisa dibuka (kunci berubah / data rusak). Nilai lama tanpa awalan "v1:" dikembalikan apa adanya.
export function open(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
