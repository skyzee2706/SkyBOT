import { readFile } from "node:fs/promises";
import { Router } from "express";
import { db } from "../db.js";
import { env } from "../env.js";
import { allocationSummary, chainLabel, publicRafflePath } from "../../shared/raffle.js";
import { raffleOgImage } from "../ogImage.js";

// Preview link per raffle (Discord, X, Telegram, ...): judul raffle, allocation, chain, status & gambarnya.
// Web ini SPA (satu index.html untuk semua halaman), jadi /raffle/:id diarahkan ke sini (lihat vercel.json):
// index.html diambil, meta tag preview-nya diganti, lalu dikirim apa adanya — aplikasinya tetap jalan normal.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let cachedHtml: { at: number; html: string } | null = null;
async function appHtml() {
  if (cachedHtml && Date.now() - cachedHtml.at < 5 * 60_000) return cachedHtml.html;
  let html: string;
  try {
    html = await readFile(new URL("../../../dist/web/index.html", import.meta.url), "utf8");
  } catch {
    // Di Vercel file build belum tentu ikut ke function; ambil dari CDN sendiri
    const res = await fetch(`${env.PUBLIC_URL}/index.html`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`index.html ${res.status}`);
    html = await res.text();
  }
  cachedHtml = { at: Date.now(), html };
  return html;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function withMeta(html: string, meta: { title: string; description: string; image: string; url: string }) {
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="SkyBOT Raffle" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`,
  ].join("\n    ");
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s[^>]*(?:property="og:[^"]*"|name="(?:description|twitter:[^"]*)")[^>]*>\s*/gi, "")
    .replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

export const ogRouter = Router();

ogRouter.get("/raffle/:id", async (req, res) => {
  const html = await appHtml();
  const raffle = await db.raffle.findUnique({
    where: { id: String(req.params.id) },
    select: {
      id: true,
      title: true,
      status: true,
      endsAt: true,
      endedAt: true,
      chain: true,
      gtdCount: true,
      fcfsCount: true,
      winnerCount: true,
      guildName: true,
    },
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
  if (!raffle || raffle.status === "CANCELLED") return void res.send(html); // preview umum SkyBOT

  // Contoh: "GTD 20 · FCFS 50 · Base · Ends Sep 30, 2026"
  const status =
    raffle.status === "ENDED"
      ? `Ended ${DATE.format(raffle.endedAt ?? raffle.endsAt)}`
      : `Ends ${DATE.format(raffle.endsAt)}`;
  const description = [allocationSummary(raffle), chainLabel(raffle.chain), status].filter(Boolean).join(" · ");
  res.send(
    withMeta(html, {
      title: raffle.guildName ? `${raffle.title} · ${raffle.guildName}` : raffle.title,
      description,
      // Kartu bertema SkyBOT (bukan gambar raffle). ?v= berubah saat status / waktu selesai berubah,
      // supaya Discord & X mengambil gambar baru, bukan cache lama.
      image: `${env.PUBLIC_URL}/api/og/raffle/${raffle.id}.png?v=${raffle.status[0]}${raffle.endsAt.getTime().toString(36)}`,
      url: `${env.PUBLIC_URL}${publicRafflePath(raffle.id)}`,
    }),
  );
});

// Gambar kartu preview (PNG 1200×630)
ogRouter.get("/api/og/raffle/:id.png", async (req, res) => {
  const raffle = await db.raffle.findUnique({ where: { id: String(req.params.id) } });
  if (!raffle || raffle.status === "CANCELLED") return void res.redirect(302, "/og.png");
  const png = await raffleOgImage(raffle);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.send(png);
});
