import { Client, Receiver } from "@upstash/qstash";
import type { Raffle } from "@prisma/client";
import { env, isLocal } from "../env.js";

// QStash (Upstash) "membangunkan" Vercel tepat saat raffle berakhir, jadi tidak perlu server yang nyala 24 jam.
// Paket gratis membatasi delay maksimal ~7 hari; raffle yang lebih lama dijadwalkan ulang berantai.
const MAX_DELAY_MS = 6 * 86_400_000;

const qstash = env.QSTASH_TOKEN ? new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL }) : null;
const receiver =
  env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({ currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY })
    : null;

export async function scheduleDraw(raffle: Pick<Raffle, "id" | "endsAt">) {
  if (isLocal) return; // lokal: ditangani ticker di dev.ts
  if (!qstash) {
    console.warn("[schedule] QSTASH_TOKEN is not set — draws will only run via the daily cron or on interaction");
    return;
  }
  const at = Math.min(raffle.endsAt.getTime(), Date.now() + MAX_DELAY_MS);
  await qstash.publishJSON({
    url: `${env.PUBLIC_URL}/api/cron/draw`,
    body: { raffleId: raffle.id },
    notBefore: Math.ceil(at / 1000),
    retries: 3,
  });
}

export async function verifyQStash(signature: string | undefined, body: string) {
  if (!receiver || !signature) return false;
  try {
    return await receiver.verify({ signature, body, url: `${env.PUBLIC_URL}/api/cron/draw` });
  } catch {
    return false;
  }
}
