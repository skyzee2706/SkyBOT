// Migrasi database yang dijalankan otomatis saat build (lihat "build" di package.json):
//
//   pre  → sebelum `prisma db push`: pindahkan data dari kolom lama ke format baru, lalu hapus kolom/tabel lama.
//          `db push` sendiri menolak menghapus kolom yang berisi data, jadi langkah ini yang melakukannya dengan aman.
//   post → sesudah `prisma db push`: perbaikan data sekali jalan (dicatat di tabel DataMigration supaya tidak diulang).
//
// Semua langkah idempoten: aman dijalankan berkali-kali, juga di database kosong.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const phase = process.argv[2];

const columnExists = async (table: string, column: string) =>
  (
    await db.$queryRaw<unknown[]>`select 1 from information_schema.columns
      where table_schema = current_schema() and table_name = ${table} and column_name = ${column}`
  ).length > 0;

async function pre() {
  // 1. Task X versi lama (1 post per raffle di kolom terpisah) → daftar xPosts
  if (await columnExists("Raffle", "xTweetId")) {
    const n = await db.$executeRawUnsafe(`
      update "Raffle"
      set "xPosts" = jsonb_build_array(jsonb_build_object(
        'tweetId', "xTweetId", 'like', "xLike", 'retweet', "xRetweet", 'quote', "xQuote"))
      where "xTweetId" is not null and ("xLike" or "xRetweet" or "xQuote")
        and ("xPosts" is null or "xPosts" = '[]'::jsonb)`);
    console.log(`[migrate] moved ${n} legacy X task rows into xPosts`);
  }
  // 2. Link quote versi lama (1 link) → daftar xQuoteUrls
  if (await columnExists("Entry", "xQuoteUrl")) {
    const n = await db.$executeRawUnsafe(`
      update "Entry" set "xQuoteUrls" = array["xQuoteUrl"]
      where "xQuoteUrl" is not null and cardinality("xQuoteUrls") = 0`);
    console.log(`[migrate] moved ${n} legacy quote links into xQuoteUrls`);
  }
  // Kolom & tabel lama lainnya (blockedRoleIds, requireAnyRole, token pesan task Discord, AdminAttempt) masih
  // ada di database tapi di-@ignore di schema. Menghapusnya menunggu deploy berikutnya: kalau dihapus sekarang,
  // versi lama yang masih melayani request selama build akan error karena masih membaca kolom itu.
}

// Perbaikan data sekali jalan. Tambahkan yang baru di akhir; jangan ubah / hapus yang sudah ada.
const POST_MIGRATIONS: { id: string; run: () => Promise<number> }[] = [
  {
    // Raffle dengan chain manual (Zcash, Sui, ...) yang dibuat saat versi 26 Sep 2026 (sekitar 16:29–16:40 UTC)
    // tersimpan sebagai wallet EVM. Seharusnya wallet chain itu sendiri (CUSTOM).
    id: "2026-09-26-custom-chain-wallet",
    run: () =>
      db.$executeRawUnsafe(`
        update "Raffle" set "walletType" = 'CUSTOM'
        where "walletType" = 'EVM' and "chain" is not null
          and "chain" not in ('ETHEREUM', 'BASE', 'ROBINHOOD', 'INK', 'ARC', 'UNICHAIN', 'SOLANA')
          and "createdAt" >= '2026-09-26T16:29:15Z' and "createdAt" < '2026-09-27T00:00:00Z'`),
  },
];

async function post() {
  for (const m of POST_MIGRATIONS) {
    if (await db.dataMigration.findUnique({ where: { id: m.id } })) continue;
    const n = await m.run();
    await db.dataMigration.create({ data: { id: m.id } });
    console.log(`[migrate] ${m.id}: ${n} row(s)`);
  }
}

try {
  if (phase === "pre") await pre();
  else if (phase === "post") await post();
  else throw new Error('Usage: tsx scripts/db-migrate.ts <pre|post>');
} finally {
  await db.$disconnect();
}
