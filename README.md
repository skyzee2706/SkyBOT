# 🎟️ Raffle Bot (ala Alphabot)

Buat raffle dari web → bot kirim giveaway ke Discord → peserta klik **Enter** → syarat dicek → undian otomatis saat waktu habis.

**Semua gratis, tanpa kartu kredit, tanpa server 24 jam:**

| Bagian | Layanan |
|---|---|
| Web + API + bot (mode HTTP) | Vercel |
| Database (PostgreSQL) | Neon |
| Jadwal undian tepat waktu | Upstash QStash |
| Login X (OAuth 1.0a, tanpa API berbayar) | X Developer |

## Fitur
- Login Discord, pilih server, buat raffle dari web
- **Role pengelola** (mis. `@CM`): member dengan role ini bisa pakai web tanpa permission Manage Server
- Embed giveaway + tombol **Enter** & **Cek status saya** di Discord
- Syarat: wajib role, role dilarang, umur akun Discord minimal, submit wallet EVM/Solana (1 wallet = 1 peserta)
- **Task X**: peserta menghubungkan akun X (1 akun X = 1 akun Discord) lewat tombol **Connect X**, lalu klik tombol
  Follow / Like / Retweet / Quote. Untuk Quote, peserta wajib mengirim link quote dari akun X yang terhubung.
  Task **tidak dicek otomatis** — username X & link quote peserta tampil di dashboard untuk dicek manual.
- Semua teks web & bot dalam bahasa Inggris
- Undian acak (crypto), **syarat Discord dicek ulang saat undian** — yang keluar server / lepas role otomatis didiskualifikasi & diganti
- Beri role ke pemenang, reroll, diskualifikasi manual, akhiri lebih awal, batalkan
- Export peserta / pemenang ke CSV (bisa dibuka di Google Sheets)

---

## Langkah Setup (semua lewat browser + 2 perintah)

### 1. Database — Neon
1. Buka **https://neon.tech** → Sign up (Google/GitHub).
2. Create project → Region **AWS Asia Pacific (Singapore)**.
3. Klik **Connect** → **matikan** *Connection pooling* → salin connection string → `DATABASE_URL`.

### 2. Aplikasi Discord
1. Buka **https://discord.com/developers/applications** → **New Application**.
2. **General Information**: *Application ID* → `DISCORD_CLIENT_ID`, *Public Key* → `DISCORD_PUBLIC_KEY`.
3. **Bot** → *Reset Token* → `DISCORD_BOT_TOKEN`. (Privileged Intents tidak perlu.)
4. **OAuth2** → *Reset Secret* → `DISCORD_CLIENT_SECRET`.

### 3. Vercel
1. Daftar di **https://vercel.com** (Hobby, gratis).
2. Di folder project: `npx vercel` → login di browser → Enter semua pertanyaan. (Deploy pertama boleh gagal.)
3. Catat domain project: `PUBLIC_URL` = `https://<nama-project>.vercel.app`

### 4. Upstash QStash
1. Daftar di **https://console.upstash.com** → menu **QStash**.
2. Salin `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.

### 5. X Developer (opsional, untuk task X)
1. Buka **https://developer.x.com** → login → **Developer Console** → buat **App**.
2. **User authentication settings → Set up**:
   - App permissions: **Read**
   - Type of App: **Web App**
   - Callback URI: `https://<nama-project>.vercel.app/api/x/callback`
   - Website URL: `https://<nama-project>.vercel.app`
3. **Keys and tokens → Consumer Keys** → *Regenerate* → `X_API_KEY` & `X_API_SECRET`.
4. **Tidak perlu isi kredit.** Kalau ternyata login X ditolak karena saldo kosong, baru pertimbangkan isi kredit kecil.

### 6. Isi Environment Variables di Vercel
Dashboard Vercel → project → **Settings → Environment Variables** → isi semua dari `.env.example`, termasuk:
- `NODEJS_HELPERS` = `0`
- `CRON_SECRET` = teks acak panjang

Lalu deploy: `npx vercel --prod` (tabel database dibuat otomatis saat build).

### 7. Hubungkan Discord ke web
Di Discord Developer Portal:
1. **OAuth2 → Redirects**: `https://<nama-project>.vercel.app/api/auth/callback`
2. **General Information → Interactions Endpoint URL**: `https://<nama-project>.vercel.app/api/interactions` → **Save**
   (kalau gagal: cek `DISCORD_PUBLIC_KEY` dan `NODEJS_HELPERS=0`).

### 8. Tes
Buka web → Login Discord → invite bot → (opsional) atur **Role pengelola raffle** → buat raffle → klik **Enter** di Discord.

---

## Catatan
- Bot tampil **offline** di daftar member Discord — normal untuk bot mode HTTP.
- Tanpa QStash, raffle tetap diundi lewat cron harian / saat ada interaksi, tapi bisa telat.
- Kuota gratis Neon / Vercel / Upstash bisa berubah; cek halaman pricing masing-masing.
- Development lokal (opsional): isi `.env` dengan `PUBLIC_URL=http://localhost:5173`, lalu `npm run dev`.
  Tombol Discord & login X hanya jalan di URL publik (Vercel).

## Struktur
```
api/index.ts                 Entry Vercel Function
src/server/app.ts            Express app (semua route /api)
src/server/api/              auth, dashboard, interactions (tombol Discord), xauth (login X), cron
src/server/raffle/           logika raffle, syarat, embed, jadwal QStash
src/server/discord.ts        Discord REST helper
src/server/x.ts              OAuth 1.0a X + link task
src/web/                     Frontend React (Vite + Tailwind)
prisma/schema.prisma         Skema database
```
