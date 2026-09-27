import { env } from "./env.js";

// Kirim peringatan ke channel Discord pemilik (webhook di ALERT_WEBHOOK_URL), mis. saat undian terputus.
// Opsional: tanpa env ini, peringatan hanya tercatat di log Vercel dan di halaman admin.
export async function alert(message: string) {
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `⚠️ ${message}`.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
  } catch (e) {
    console.error("[alert] failed to send", e);
  }
}
