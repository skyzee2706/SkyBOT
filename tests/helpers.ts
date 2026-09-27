import { discordKeys } from "./env.js";
import { sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { DiscordAPIError } from "discord.js";
import app from "../src/server/app.js";
import { db } from "../src/server/db.js";
import { rest } from "../src/server/discord.js";

export { app, db };

// ---- Discord palsu: member per server, kegagalan yang bisa diatur, dan semua pesan yang dikirim bot ----
export const discord = {
  members: new Map<string, Map<string, string[]>>(), // guildId → userId → roleIds
  failMemberFetches: 0, // n panggilan fetchMember berikutnya gagal (error jaringan)
  failPatches: 0,
  owner: "0", // pemilik server palsu (dianggap admin server)
  posted: [] as { route: string; body: any }[],
  patched: [] as { route: string; body: any }[],
  deleted: [] as string[],
  reset() {
    this.members.clear();
    this.failMemberFetches = 0;
    this.failPatches = 0;
    this.posted = [];
    this.patched = [];
    this.deleted = [];
    this.owner = "0";
  },
  addMember(guildId: string, userId: string, roles: string[] = []) {
    if (!this.members.has(guildId)) this.members.set(guildId, new Map());
    this.members.get(guildId)!.set(userId, roles);
  },
};

const apiError = (code: number, status: number, url: string) =>
  new DiscordAPIError({ code, message: "error" }, code, status, "GET", url, {});

const r = rest as any;
r.get = async (route: string) => {
  const member = route.match(/^\/guilds\/(\d+)\/members\/(\d+)$/);
  if (member) {
    if (discord.failMemberFetches > 0) {
      discord.failMemberFetches--;
      throw new Error("socket hang up");
    }
    const roles = discord.members.get(member[1])?.get(member[2]);
    if (!roles) throw apiError(10007, 404, route);
    return { roles, user: { id: member[2], username: `user${member[2].slice(-3)}`, avatar: null } };
  }
  const guild = route.match(/^\/guilds\/(\d+)$/);
  if (guild) return { id: guild[1], name: "Test Server", icon: null, owner_id: discord.owner, roles: [] };
  if (/^\/guilds\/\d+\/channels$/.test(route)) return [];
  return {};
};
r.post = async (route: string, o: any) => {
  discord.posted.push({ route, body: o?.body });
  return { id: String(Date.now()) };
};
r.patch = async (route: string, o: any) => {
  if (discord.failPatches > 0) {
    discord.failPatches--;
    throw new Error("Discord 500");
  }
  discord.patched.push({ route, body: o?.body });
  return {};
};
r.put = async () => ({});
r.delete = async (route: string) => {
  discord.deleted.push(route);
  return {};
};

// ---- Server HTTP untuk tes endpoint ----
export async function startServer() {
  const server = app.listen(0);
  await new Promise((ok) => server.once("listening", ok));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((ok) => server.close(ok)) };
}

// Kirim interaksi Discord bertanda tangan (seperti yang dikirim Discord ke /api/interactions)
export async function interaction(base: string, body: Record<string, unknown>) {
  const raw = JSON.stringify({ application_id: "123456789012345678", token: "tok", ...body });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(ts + raw), discordKeys.privateKey).toString("hex");
  const res = await fetch(`${base}/api/interactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature-ed25519": signature, "x-signature-timestamp": ts },
    body: raw,
  });
  return res.json();
}

export const button = (base: string, userId: string, customId: string, roles: string[] = []) =>
  interaction(base, { type: 3, member: { user: { id: userId, username: `u${userId.slice(-3)}` }, roles }, data: { custom_id: customId, component_type: 2 } });

export const modal = (base: string, userId: string, customId: string, values: Record<string, string>) =>
  interaction(base, {
    type: 5,
    member: { user: { id: userId, username: `u${userId.slice(-3)}` }, roles: [] },
    data: {
      custom_id: customId,
      components: Object.entries(values).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })),
    },
  });

// ---- Data ----
let seq = 0;
export const snowflake = () => String(800000000000000000n + BigInt(Date.now() % 1_000_000) * 1000n + BigInt(seq++));
export const GUILD = "700000000000000001";

export async function resetDb() {
  // Urutan penting karena relasi
  await db.auditLog.deleteMany();
  await db.taskProgress.deleteMany();
  await db.entry.deleteMany();
  await db.raffle.deleteMany();
  await db.userWallet.deleteMany();
  await db.xLink.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.rateLimit.deleteMany();
  await db.image.deleteMany();
}

export function makeRaffle(data: Record<string, unknown> = {}) {
  return db.raffle.create({
    data: {
      title: "Test Raffle",
      guildId: GUILD,
      channelId: "700000000000000002",
      messageId: "700000000000000003",
      createdById: "700000000000000004",
      winnerCount: 1,
      gtdCount: 1,
      endsAt: new Date(Date.now() + 3_600_000),
      walletType: "EVM",
      ...data,
    } as any,
  });
}

// Peserta: member server + entry di raffle
export async function addEntries(raffleId: string, n: number, opts: { member?: boolean } = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const userId = snowflake();
    if (opts.member !== false) discord.addMember(GUILD, userId);
    await db.entry.create({ data: { raffleId, userId, username: `p${i}`, wallet: `0x${userId.padStart(40, "0")}` } });
    ids.push(userId);
  }
  return ids;
}

// Sesi login web untuk user tertentu → header cookie
export async function login(userId: string, username = "tester") {
  await db.user.upsert({ where: { id: userId }, create: { id: userId, username }, update: {} });
  const sid = `sid-${userId}`;
  await db.session.upsert({
    where: { id: sid },
    create: { id: sid, userId, accessToken: "token", expiresAt: new Date(Date.now() + 3_600_000) },
    update: {},
  });
  return { cookie: `sid=${sid}`, "content-type": "application/json" };
}

export const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
