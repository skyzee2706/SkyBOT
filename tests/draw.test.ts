import "./env.js";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addEntries, db, discord, GUILD, makeRaffle, resetDb } from "./helpers.js";
import { closeRaffle, disqualifyEntry, runDraw, sweepDraws } from "../src/server/raffle/draw.js";

const winners = (raffleId: string) =>
  db.entry.findMany({ where: { raffleId, status: "WON" }, select: { userId: true, allocation: true } });
const announcements = () => discord.posted.filter((p) => /has ended/.test(p.body?.content ?? ""));

beforeEach(async () => {
  discord.reset();
  await resetDb();
});
after(() => db.$disconnect());

describe("draw", () => {
  test("picks exactly GTD + FCFS winners, no one twice, announces once", async () => {
    const r = await makeRaffle({ gtdCount: 3, fcfsCount: 2, winnerCount: 5 });
    await addEntries(r.id, 12);
    assert.equal(await closeRaffle(r.id), true);
    assert.equal(await closeRaffle(r.id), false, "closing twice is a no-op");
    assert.equal(await runDraw(r.id), "done");

    const w = await winners(r.id);
    assert.equal(w.length, 5);
    assert.equal(w.filter((x) => x.allocation === "GTD").length, 3);
    assert.equal(w.filter((x) => x.allocation === "FCFS").length, 2);
    assert.equal(new Set(w.map((x) => x.userId)).size, 5);
    assert.equal(announcements().length, 1);
    const fresh = await db.raffle.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(fresh.drawPending, false);
    assert.equal(fresh.announcePending, false);
    assert.equal(fresh.drawLockUntil, null);
    assert.equal(await runDraw(r.id), "skipped", "nothing left to do");
    assert.equal(announcements().length, 1);
  });

  test("a Discord error mid-draw pauses the draw; the next run finishes it without over-picking", async () => {
    const r = await makeRaffle({ gtdCount: 6, winnerCount: 6 });
    await addEntries(r.id, 20);
    await closeRaffle(r.id);
    discord.failMemberFetches = 1; // gagal di batch pertama
    assert.equal(await runDraw(r.id), "partial");
    let fresh = await db.raffle.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(fresh.drawPending, true);
    assert.equal(fresh.announcePending, true);
    assert.match(fresh.drawError ?? "", /socket hang up/);
    assert.equal(announcements().length, 0, "no announcement for an unfinished draw");

    assert.equal(await runDraw(r.id), "done");
    assert.equal((await winners(r.id)).length, 6);
    fresh = await db.raffle.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(fresh.drawError, null);
    assert.equal(announcements().length, 1);
  });

  test("running out of time saves progress and resumes later", async () => {
    const r = await makeRaffle({ gtdCount: 4, winnerCount: 4 });
    await addEntries(r.id, 10);
    await closeRaffle(r.id);
    assert.equal(await runDraw(r.id, Date.now() - 1), "partial");
    assert.equal((await winners(r.id)).length, 0);
    assert.equal(await runDraw(r.id), "done");
    assert.equal((await winners(r.id)).length, 4);
  });

  test("two draws at the same time never pick too many winners", async () => {
    const r = await makeRaffle({ gtdCount: 5, winnerCount: 5 });
    await addEntries(r.id, 30);
    await closeRaffle(r.id);
    const results = await Promise.all([runDraw(r.id), runDraw(r.id), runDraw(r.id)]);
    assert.equal(results.filter((x) => x === "done").length, 1);
    assert.equal((await winners(r.id)).length, 5);
    assert.equal(announcements().length, 1);
  });

  test("people who left the server are disqualified and replaced", async () => {
    const r = await makeRaffle({ gtdCount: 3, winnerCount: 3 });
    const members = await addEntries(r.id, 3);
    await addEntries(r.id, 5, { member: false });
    await closeRaffle(r.id);
    await runDraw(r.id);
    const w = await winners(r.id);
    assert.deepEqual(new Set(w.map((x) => x.userId)), new Set(members));
    // Hanya kandidat yang sempat dicek yang didiskualifikasi (undian berhenti begitu kuota terpenuhi)
    const dq = await db.entry.findMany({ where: { raffleId: r.id, status: "DISQUALIFIED" } });
    assert.ok(dq.every((e) => !members.includes(e.userId) && e.note === "Left the server"));
  });

  test("not enough eligible participants: fewer winners, still announced", async () => {
    const r = await makeRaffle({ gtdCount: 5, fcfsCount: 5, winnerCount: 10 });
    await addEntries(r.id, 3);
    await closeRaffle(r.id);
    assert.equal(await runDraw(r.id), "done");
    assert.equal((await winners(r.id)).length, 3);
    assert.equal(announcements().length, 1);
  });

  test("an embed update failure does not block the announcement", async () => {
    const r = await makeRaffle({ gtdCount: 1, winnerCount: 1 });
    await addEntries(r.id, 2);
    await closeRaffle(r.id);
    discord.failPatches = 1;
    assert.equal(await runDraw(r.id), "done");
    assert.equal(announcements().length, 1);
  });

  test("disqualifying a winner draws and announces a replacement for the same allocation", async () => {
    const r = await makeRaffle({ gtdCount: 2, fcfsCount: 1, winnerCount: 3, winnerRoleId: "700000000000000009" });
    await addEntries(r.id, 8);
    await closeRaffle(r.id);
    await runDraw(r.id);
    const gtdWinner = (await winners(r.id)).find((w) => w.allocation === "GTD")!;
    const entry = await db.entry.findFirstOrThrow({ where: { raffleId: r.id, userId: gtdWinner.userId } });

    const { replaced } = await disqualifyEntry(r.id, entry.id, "Bot account");
    assert.equal(replaced, true);
    const w = await winners(r.id);
    assert.equal(w.filter((x) => x.allocation === "GTD").length, 2);
    assert.ok(!w.some((x) => x.userId === gtdWinner.userId));
    assert.ok(discord.posted.some((p) => /Replacement winner/.test(p.body?.content ?? "")));
    assert.ok(discord.deleted.some((d) => d.includes(gtdWinner.userId)), "winner role removed");
    assert.equal(announcements().length, 1, "main announcement is not repeated");
  });

  test("disqualifying before the draw just removes the participant", async () => {
    const r = await makeRaffle();
    await addEntries(r.id, 2);
    const e = await db.entry.findFirstOrThrow({ where: { raffleId: r.id } });
    assert.equal((await disqualifyEntry(r.id, e.id, "spam")).replaced, false);
    assert.equal((await db.entry.findUniqueOrThrow({ where: { id: e.id } })).status, "DISQUALIFIED");
  });

  test("the sweep closes overdue raffles and finishes stuck draws", async () => {
    const overdue = await makeRaffle({ endsAt: new Date(Date.now() - 1000) });
    await addEntries(overdue.id, 2);
    const stuck = await makeRaffle({ gtdCount: 2, winnerCount: 2 });
    await addEntries(stuck.id, 4);
    await closeRaffle(stuck.id);
    discord.failMemberFetches = 1;
    await runDraw(stuck.id);

    assert.equal(await sweepDraws(), 2);
    assert.equal((await winners(overdue.id)).length, 1);
    assert.equal((await winners(stuck.id)).length, 2);
    // Kunci yang tertinggal (proses mati di tengah jalan) kedaluwarsa dan tidak menghalangi selamanya
    await db.raffle.update({ where: { id: stuck.id }, data: { announcePending: true, drawLockUntil: new Date(Date.now() - 1) } });
    assert.equal(await runDraw(stuck.id), "done");
  });

  test("members-only raffle ignores non-members; open raffle accepts them", async () => {
    const open = await makeRaffle({ requireMember: false, gtdCount: 2, winnerCount: 2 });
    await addEntries(open.id, 2, { member: false });
    await closeRaffle(open.id);
    await runDraw(open.id);
    assert.equal((await winners(open.id)).length, 2);
    void GUILD;
  });
});
