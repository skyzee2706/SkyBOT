import app from "./app.js";
import { env } from "./env.js";
import { sweepDraws } from "./raffle/draw.js";

// Server lokal untuk development. Di Vercel, file api/index.ts yang dipakai.
app.listen(env.PORT, () => {
  console.log(`[dev] API running at http://localhost:${env.PORT} — open the web app at ${env.PUBLIC_URL}`);
});

// Lokal tidak ada QStash, jadi cek raffle yang sudah waktunya diundi (atau undian yang tertunda) tiap 10 detik.
setInterval(() => {
  sweepDraws().catch((e) => console.error("[dev] failed to check raffles", e));
}, 10_000);
