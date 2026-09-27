import "./env.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db, discord, login, makeRaffle, resetDb, snowflake, startServer } from "./helpers.js";
import { createLinkToken } from "../src/server/x.js";
import { open, seal } from "../src/server/secretBox.js";
import { importImageFromUrl } from "../src/server/api/images.js";

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
const ADMIN = "900000000000000001";

describe("admin page", () => {
  test("only Discord IDs in ADMIN_DISCORD_IDS can see stats", async () => {
    assert.equal((await fetch(`${server.base}/api/admin/stats`)).status, 404);
    const other = await login(snowflake());
    assert.equal((await fetch(`${server.base}/api/admin/stats`, { headers: other })).status, 404);
    const admin = await login(ADMIN);
    const res = await fetch(`${server.base}/api/admin/stats`, { headers: admin });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).attention));
    const session = await (await fetch(`${server.base}/api/admin/session`, { headers: admin })).json();
    assert.deepEqual(session, { enabled: true, loggedIn: true, isAdmin: true });
  });
});

describe("rate limits", () => {
  test("saving wallets is limited per user", async () => {
    const headers = await login(snowflake());
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const address = `0x${String(i).padStart(40, "a")}`;
      statuses.push((await fetch(`${server.base}/api/p/me/wallet`, { method: "POST", headers, body: JSON.stringify({ type: "EVM", address }) })).status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  });
});

describe("Connect X link", () => {
  test("shows which Discord account will be linked, and refuses someone else's link", async () => {
    const owner = snowflake();
    await db.user.create({ data: { id: owner, username: "rightful" } });
    const url = `${server.base}/api/x/connect?t=${encodeURIComponent(createLinkToken(owner))}`;
    const page = await (await fetch(url)).text();
    assert.match(page, /rightful/);
    assert.match(page, /Continue to X/);

    const intruder = await login(snowflake());
    const res = await fetch(url, { headers: intruder });
    assert.equal(res.status, 403);
  });
});

describe("stored secrets", () => {
  test("access tokens are encrypted; old plaintext sessions are re-encrypted on use", async () => {
    assert.equal(open(seal("abc")), "abc");
    assert.equal(open("v1:garbage"), null);
    const user = snowflake();
    const headers = await login(user);
    assert.equal((await db.session.findFirstOrThrow({ where: { userId: user } })).accessToken, "token");
    assert.equal((await fetch(`${server.base}/api/me`, { headers })).status, 200);
    const stored = (await db.session.findFirstOrThrow({ where: { userId: user } })).accessToken;
    assert.match(stored, /^v1:/);
    assert.equal(open(stored), "token");
  });
});

describe("image links", () => {
  test("internal addresses and plain http are refused", async () => {
    for (const url of ["https://127.0.0.1/a.png", "https://localhost/a.png", "http://example.com/a.png", "https://[::1]/a.png", "https://169.254.169.254/latest"]) {
      const r = await importImageFromUrl(url, "1", "1");
      assert.ok("error" in r, url);
    }
  });
});

describe("edit raffle", () => {
  test("host can edit text and end time of a running raffle; changes are logged", async () => {
    const host = snowflake();
    discord.owner = host;
    discord.addMember("700000000000000001", host);
    const headers = await login(host, "Host");
    const r = await makeRaffle();
    const endsAt = new Date(Date.now() + 7_200_000).toISOString();
    let res = await fetch(`${server.base}/api/raffles/${r.id}`, { method: "PATCH", headers, body: JSON.stringify({ title: "New title", endsAt }) });
    assert.equal(res.status, 200);
    const fresh = await db.raffle.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(fresh.title, "New title");
    assert.equal(fresh.endsAt.toISOString(), endsAt);
    const log = await db.auditLog.findMany({ where: { raffleId: r.id } });
    assert.equal(log[0].action, "edited");
    assert.match(log[0].detail ?? "", /title/);
    assert.ok(discord.patched.length > 0, "Discord embed refreshed");

    res = await fetch(`${server.base}/api/raffles/${r.id}`, { method: "PATCH", headers, body: JSON.stringify({ imageUrl: "http://evil.test/x.png" }) });
    assert.equal(res.status, 400);

    await db.raffle.update({ where: { id: r.id }, data: { status: "ENDED" } });
    res = await fetch(`${server.base}/api/raffles/${r.id}`, { method: "PATCH", headers, body: JSON.stringify({ title: "x" }) });
    assert.equal(res.status, 400);
  });

  test("non-managers cannot edit", async () => {
    const headers = await login(snowflake());
    const r = await makeRaffle();
    const res = await fetch(`${server.base}/api/raffles/${r.id}`, { method: "PATCH", headers, body: JSON.stringify({ title: "hack" }) });
    assert.equal(res.status, 403);
  });
});
