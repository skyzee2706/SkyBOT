import "dotenv/config";
import { z } from "zod";

const required = (name: string) => z.string().min(1, `${name} belum diisi`);

const schema = z.object({
  DISCORD_CLIENT_ID: required("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: required("DISCORD_CLIENT_SECRET"),
  DISCORD_BOT_TOKEN: required("DISCORD_BOT_TOKEN"),
  DISCORD_PUBLIC_KEY: required("DISCORD_PUBLIC_KEY"),
  DATABASE_URL: required("DATABASE_URL"),
  PUBLIC_URL: z.string().url().default("http://localhost:5173"),
  // Upstash QStash: menjadwalkan undian tepat waktu. Opsional saat development lokal.
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_URL: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  // X (Twitter) — hanya untuk login OAuth 1.0a (tanpa API berbayar). Kosong = fitur task X nonaktif.
  X_API_KEY: z.string().optional(),
  X_API_SECRET: z.string().optional(),
  // Diisi otomatis oleh Vercel Cron bila di-set di Project Settings.
  CRON_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`[ENV] Ada yang belum diisi:\n${msg}\nLokal: salin .env.example jadi .env. Vercel: isi di Project Settings > Environment Variables.`);
}

export const env = { ...parsed.data, PUBLIC_URL: parsed.data.PUBLIC_URL.replace(/\/$/, "") };

export const isLocal = /localhost|127\.0\.0\.1/.test(env.PUBLIC_URL);
export const xEnabled = !!(env.X_API_KEY && env.X_API_SECRET);
export const OAUTH_REDIRECT = `${env.PUBLIC_URL}/api/auth/callback`;

// View Channel, Send Messages, Embed Links, Read Message History, Manage Roles
const BOT_PERMISSIONS = "268520448";
export const botInviteUrl = (guildId?: string) =>
  `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}` +
  (guildId ? `&guild_id=${guildId}&disable_guild_select=true` : "");
