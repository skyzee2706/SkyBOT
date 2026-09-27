import { Router } from "express";
import { db } from "../db.js";
import { env } from "../env.js";
import { background, endRaffle, runDraw, sweepDraws } from "../raffle/draw.js";
import { scheduleDraw, verifyQStash } from "../raffle/schedule.js";
import { cleanupData } from "../cleanup.js";
import { readRawBody } from "./rawBody.js";

export const cronRouter = Router();

// Dipanggil QStash tepat saat raffle berakhir, dan untuk melanjutkan undian yang terputus.
// Dijawab langsung; undian berjalan di belakang layar (maks ±40 detik per panggilan, lalu dilanjutkan berantai).
cronRouter.post("/draw", async (req, res) => {
  const body = await readRawBody(req);
  if (!(await verifyQStash(req.header("upstash-signature"), body))) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  const { raffleId } = JSON.parse(body) as { raffleId: string };
  const raffle = await db.raffle.findUnique({ where: { id: raffleId } });
  if (raffle?.status === "ACTIVE") {
    // Raffle > 6 hari dijadwalkan berantai; kalau belum waktunya, jadwalkan lagi.
    if (raffle.endsAt.getTime() > Date.now() + 5_000) await scheduleDraw(raffle);
    else background(endRaffle(raffle.id), "draw");
  } else if (raffle?.status === "ENDED" && (raffle.drawPending || raffle.announcePending)) {
    background(runDraw(raffle.id), "draw");
  }
  res.json({ ok: true });
});

// Vercel Cron harian: jaring pengaman untuk undian yang terlewat / tertunda, plus bersih-bersih data lama.
cronRouter.get("/sweep", async (req, res) => {
  if (!env.CRON_SECRET || req.header("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const draws = await sweepDraws();
  const cleaned = await cleanupData();
  res.json({ draws, ...cleaned });
});
