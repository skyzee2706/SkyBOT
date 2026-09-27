import "./env.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addEntries, db, discord, makeRaffle, resetDb, startServer } from "./helpers.js";
import { closeRaffle, runDraw } from "../src/server/raffle/draw.js";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => (server = await startServer()));
after(async () => {
  await server.close();
  await db.$disconnect();
});
beforeEach(async () => {
  discord.reset();
  await resetDb();
});
const get = (path: string) => fetch(`${server.base}/api${path}`).then((r) => r.json());

describe("raffle list", () => {
  test("Active and Ended tabs, 24 per page, cancelled raffles hidden", async () => {
    for (let i = 0; i < 26; i++) await makeRaffle({ title: `live ${i}`, endsAt: new Date(Date.now() + (i + 1) * 3_600_000) });
    for (let i = 0; i < 3; i++)
      await makeRaffle({ title: `ended ${i}`, status: "ENDED", endsAt: new Date(Date.now() - (i + 1) * 3_600_000), endedAt: new Date(Date.now() - (i + 1) * 3_600_000) });
    await makeRaffle({ title: "cancelled", status: "CANCELLED" });

    let d = await get("/p/raffles");
    assert.equal(d.total, 26);
    assert.equal(d.raffles.length, 24);
    assert.equal(d.totalPages, 2);
    assert.equal(d.raffles[0].title, "live 0", "ending soonest first");
    d = await get("/p/raffles?page=2");
    assert.equal(d.raffles.length, 2);

    d = await get("/p/raffles?status=ended");
    assert.equal(d.total, 3);
    assert.equal(d.raffles[0].title, "ended 0", "recently ended first");
    assert.ok(d.raffles.every((r: any) => r.status === "ENDED"));
  });

  test("best odds sorts by spots per participant across all raffles", async () => {
    const crowded = await makeRaffle({ title: "crowded", winnerCount: 1, gtdCount: 1 });
    await addEntries(crowded.id, 10);
    const roomy = await makeRaffle({ title: "roomy", winnerCount: 5, gtdCount: 5 });
    await addEntries(roomy.id, 2);
    const d = await get("/p/raffles?sort=odds");
    assert.deepEqual(d.raffles.map((r: any) => r.title), ["roomy", "crowded"]);
  });
});

describe("participant list", () => {
  test("20 per page, winners first after the draw", async () => {
    const r = await makeRaffle({ gtdCount: 25, winnerCount: 25 });
    await addEntries(r.id, 53);
    await closeRaffle(r.id);
    await runDraw(r.id);
    const all: any[] = [];
    for (let p = 1; p <= 3; p++) all.push(...(await get(`/p/raffles/${r.id}/entries?page=${p}`)).entries);
    assert.equal(all.length, 53);
    assert.equal(new Set(all.map((e) => e.id)).size, 53);
    assert.ok(all.slice(0, 25).every((e) => e.winner));
    assert.ok(all.slice(25).every((e) => !e.winner));
  });

  test("public pages never expose wallets or X data", async () => {
    const r = await makeRaffle();
    await addEntries(r.id, 2);
    const text = JSON.stringify([await get(`/p/raffles/${r.id}`), await get(`/p/raffles/${r.id}/entries`)]);
    assert.doesNotMatch(text, /0x0{10}/);
  });
});

describe("link preview", () => {
  test("each raffle page has its own title, summary and image", async () => {
    const r = await makeRaffle({
      title: "Nebula <Pass>",
      guildName: "Nebula Labs",
      gtdCount: 20,
      fcfsCount: 50,
      winnerCount: 70,
      chain: "BASE",
      imageUrl: "https://skybot.test/api/images/abc",
      endsAt: new Date("2026-09-30T12:00:00Z"),
    });
    const html = await (await fetch(`${server.base}/raffle/${r.id}`)).text();
    assert.match(html, /<meta property="og:title" content="Nebula &#60;Pass&#62; · Nebula Labs" \/>/);
    assert.match(html, /<meta property="og:description" content="GTD 20 · FCFS 50 · Base · Ends Sep 30, 2026" \/>/);
    assert.match(html, new RegExp(`og:image" content="https://skybot.test/api/og/raffle/${r.id}.png\\?v=`));

    // Kartu preview bertema SkyBOT (PNG 1200×630), bukan gambar raffle
    const img = await fetch(`${server.base}/api/og/raffle/${r.id}.png`);
    assert.equal(img.headers.get("content-type"), "image/png");
    const png = Buffer.from(await img.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    assert.equal(html.match(/property="og:title"/g)?.length, 1, "generic tags replaced, not duplicated");
    assert.match(html, /<script type="module"/, "the app still loads");
  });

  test("unknown raffles fall back to the default preview", async () => {
    const html = await (await fetch(`${server.base}/raffle/does-not-exist`)).text();
    assert.match(html, /og:image" content="https:\/\/skybot-raffle.vercel.app\/og.png"/);
  });
});
