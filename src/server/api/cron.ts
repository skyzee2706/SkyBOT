import { Router } from "express";
import { db } from "../db.js";
import { env } from "../env.js";
import { endOverdueRaffles, endRaffle } from "../raffle/service.js";
import { scheduleDraw, verifyQStash } from "../raffle/schedule.js";
import { readRawBody } from "./rawBody.js";

export const cronRouter = Router();

// Dipanggil QStash tepat saat raffle berakhir.
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
    else await endRaffle(raffle.id);
  }
  res.json({ ok: true });
});

// Vercel Cron harian: jaring pengaman untuk raffle yang terlewat.
cronRouter.get("/sweep", async (req, res) => {
  if (!env.CRON_SECRET || req.header("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ ended: await endOverdueRaffles() });
});
