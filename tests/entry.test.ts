import "./env.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { button, db, discord, GUILD, login, makeRaffle, modal, resetDb, snowflake, startServer, wait } from "./helpers.js";

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

const EVM = (c: string) => `0x${c.repeat(40)}`;
const entryOf = (raffleId: string, userId: string) => db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId } } });
const components = (r: any) => JSON.stringify(r.data?.components ?? []);
const lastReply = () => discord.patched.at(-1)?.body?.content ?? "";

describe("Discord entry", () => {
  test("first entry asks for the wallet once, then it is reused", async () => {
    const user = snowflake();
    const r1 = await makeRaffle();
    const r2 = await makeRaffle();

    let res = await button(server.base, user, `raffle:enter:${r1.id}:EVM:-`);
    assert.equal(res.type, 9, "popup form");
    assert.match(components(res), /"wallet"/);

    await modal(server.base, user, `raffle:submit:${r1.id}`, { wallet: EVM("A") });
    await wait(300);
    assert.equal((await entryOf(r1.id, user))?.wallet, EVM("a"), "saved lowercase");
    assert.equal((await db.userWallet.findUnique({ where: { discordId: user } }))?.evm, EVM("a"));

    res = await button(server.base, user, `raffle:enter:${r2.id}:EVM:-`);
    assert.equal(res.type, 5, "no form the second time");
    await wait(300);
    assert.equal((await entryOf(r2.id, user))?.wallet, EVM("a"));

    res = await button(server.base, user, `raffle:enter:${r2.id}:EVM:-`);
    assert.equal(res.type, 4);
    assert.match(res.data.content, /already entered/);
  });

  test("a wallet can belong to one Discord account only", async () => {
    const [a, b] = [snowflake(), snowflake()];
    const r = await makeRaffle();
    await modal(server.base, a, `raffle:submit:${r.id}`, { wallet: EVM("b") });
    await wait(300);
    await modal(server.base, b, `raffle:submit:${r.id}`, { wallet: EVM("b") });
    await wait(300);
    assert.match(lastReply(), /already connected to another Discord account/);
    assert.equal(await entryOf(r.id, b), null);
  });

  test("X tasks: not connected → Connect X button; quote task → form with quote only", async () => {
    const user = snowflake();
    const r = await makeRaffle({ xFollowUsernames: ["nebula"], xPosts: [{ tweetId: "55", like: true, retweet: false, quote: true }] });
    let res = await button(server.base, user, `raffle:enter:${r.id}:EVM:X`);
    assert.equal(res.type, 4);
    assert.match(components(res), /\/api\/x\/connect/);

    await db.xLink.create({ data: { discordId: user, xUserId: "x1", xUsername: "bee" } });
    await db.userWallet.create({ data: { discordId: user, evm: EVM("c") } });
    res = await button(server.base, user, `raffle:enter:${r.id}:EVM:X`);
    assert.equal(res.type, 9);
    assert.match(components(res), /quote1/);
    assert.doesNotMatch(components(res), /"wallet"/);

    await modal(server.base, user, `raffle:submit:${r.id}`, { quote1: "https://x.com/bee/status/999" });
    await wait(300);
    const e = await entryOf(r.id, user);
    assert.deepEqual(e?.xQuoteUrls, ["https://x.com/bee/status/999"]);
    assert.equal(e?.xUsername, "bee");
  });

  test("missing required role is answered before the form", async () => {
    const user = snowflake();
    const r = await makeRaffle({ requiredRoleIds: ["555", "666"] });
    let res = await button(server.base, user, `raffle:enter:${r.id}:EVM:-`);
    assert.equal(res.type, 4);
    assert.match(res.data.content, /one of these roles/);
    res = await button(server.base, user, `raffle:enter:${r.id}:EVM:-`, ["666"]);
    assert.equal(res.type, 9, "any one of the roles is enough");
  });

  test("custom chain: asks for that chain's wallet every time and does not save it", async () => {
    const user = snowflake();
    await db.userWallet.create({ data: { discordId: user, evm: EVM("d") } });
    const r = await makeRaffle({ walletType: "CUSTOM", chain: "Zcash" });
    const res = await button(server.base, user, `raffle:enter:${r.id}:CUSTOM:-`);
    assert.equal(res.type, 9);
    assert.match(components(res), /Zcash wallet address/);
    await modal(server.base, user, `raffle:submit:${r.id}`, { wallet: "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU" });
    await wait(300);
    assert.equal((await entryOf(r.id, user))?.wallet, "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU");
    const saved = await db.userWallet.findUnique({ where: { discordId: user } });
    assert.equal(saved?.evm, EVM("d"));
    assert.equal(saved?.sol, null);
  });

  test("entering an overdue raffle closes it without waiting for the draw", async () => {
    const user = snowflake();
    discord.addMember(GUILD, user);
    const r = await makeRaffle({ endsAt: new Date(Date.now() - 1000), walletType: "NONE" });
    await button(server.base, user, `raffle:enter:${r.id}:NONE:-`);
    await wait(500);
    assert.ok(discord.patched.some((p) => /already ended/.test(p.body?.content ?? "")));
    assert.equal((await db.raffle.findUniqueOrThrow({ where: { id: r.id } })).status, "ENDED");
  });
});

describe("web entry and profile", () => {
  test("saved wallet is used on the web; changing it updates running raffles only", async () => {
    const user = snowflake();
    const headers = await login(user);
    const running = await makeRaffle({ requireMember: false });
    const ended = await makeRaffle({ requireMember: false });

    let res = await fetch(`${server.base}/api/p/me/wallet`, { method: "POST", headers, body: JSON.stringify({ type: "EVM", address: EVM("e") }) });
    assert.equal(res.status, 200);
    res = await fetch(`${server.base}/api/p/raffles/${running.id}/enter`, { method: "POST", headers, body: "{}" });
    assert.equal(res.status, 200);
    res = await fetch(`${server.base}/api/p/raffles/${ended.id}/enter`, { method: "POST", headers, body: "{}" });
    assert.equal(res.status, 200);
    await db.raffle.update({ where: { id: ended.id }, data: { status: "ENDED" } });

    await fetch(`${server.base}/api/p/me/wallet`, { method: "POST", headers, body: JSON.stringify({ type: "EVM", address: EVM("f") }) });
    assert.equal((await entryOf(running.id, user))?.wallet, EVM("f"));
    assert.equal((await entryOf(ended.id, user))?.wallet, EVM("e"));

    res = await fetch(`${server.base}/api/p/me/wallet?type=EVM`, { method: "DELETE", headers });
    assert.equal(res.status, 200);
    assert.equal((await db.userWallet.findUnique({ where: { discordId: user } }))?.evm, null);
  });

  test("web entry still requires opening every X task", async () => {
    const user = snowflake();
    const headers = await login(user);
    await db.xLink.create({ data: { discordId: user, xUserId: "x9", xUsername: "web" } });
    const r = await makeRaffle({ walletType: "NONE", requireMember: false, xFollowUsernames: ["nebula"] });
    const res = await fetch(`${server.base}/api/p/raffles/${r.id}/enter`, { method: "POST", headers, body: "{}" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Open every task/);
  });

  test("disconnect X", async () => {
    const user = snowflake();
    const headers = await login(user);
    await db.xLink.create({ data: { discordId: user, xUserId: "x7", xUsername: "gone" } });
    await fetch(`${server.base}/api/p/me/x`, { method: "DELETE", headers });
    assert.equal(await db.xLink.count({ where: { discordId: user } }), 0);
  });
});
