import app from "./app.js";
import { env } from "./env.js";
import { endOverdueRaffles } from "./raffle/service.js";

// Server lokal untuk development. Di Vercel, file api/index.ts yang dipakai.
app.listen(env.PORT, () => {
  console.log(`[dev] API jalan di http://localhost:${env.PORT} — buka web di ${env.PUBLIC_URL}`);
});

// Lokal tidak ada QStash, jadi cek raffle yang sudah waktunya diundi tiap 10 detik.
setInterval(() => {
  endOverdueRaffles().catch((e) => console.error("[dev] gagal cek raffle", e));
}, 10_000);
