import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  REST,
  Routes,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIRole,
} from "discord.js";
import { env } from "./env.js";

// Bot berjalan tanpa koneksi gateway: semua aksi lewat REST API, klik tombol masuk lewat HTTP (/api/interactions).
export const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
export const BOT_USER_ID = env.DISCORD_CLIENT_ID;

export const isDiscordError = (e: unknown, ...codes: number[]) =>
  e instanceof DiscordAPIError && (codes.length === 0 || codes.includes(Number(e.code)));

const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;
const UNKNOWN_GUILD = 10004;
const MISSING_ACCESS = 50001;

export async function fetchMember(guildId: string, userId: string): Promise<APIGuildMember | null> {
  try {
    return (await rest.get(Routes.guildMember(guildId, userId))) as APIGuildMember;
  } catch (e) {
    if (isDiscordError(e, UNKNOWN_MEMBER, UNKNOWN_USER)) return null;
    throw e;
  }
}

export async function fetchBotGuildIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: "200", ...(after ? { after } : {}) });
    const page = (await rest.get(Routes.userGuilds(), { query })) as { id: string }[];
    page.forEach((g) => ids.add(g.id));
    if (page.length < 200) return ids;
    after = page[page.length - 1].id;
  }
}

const MANAGE = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild;

export type GuildContext = {
  guild: APIGuild;
  roles: APIRole[];
  /** Owner / Administrator / Manage Server */
  isAdmin: boolean;
  /** null kalau user bukan member server */
  memberRoleIds: string[] | null;
  botTopPosition: number;
};

// Ambil data server + permission user. Dicek langsung ke Discord supaya perubahan role langsung berlaku.
export async function getGuildContext(guildId: string, userId: string): Promise<GuildContext | null> {
  let guild: APIGuild;
  try {
    guild = (await rest.get(Routes.guild(guildId))) as APIGuild;
  } catch (e) {
    if (isDiscordError(e, UNKNOWN_GUILD, MISSING_ACCESS)) return null;
    throw e;
  }
  const [member, botMember] = await Promise.all([fetchMember(guildId, userId), fetchMember(guildId, BOT_USER_ID)]);
  const roles = guild.roles;
  const byId = new Map(roles.map((r) => [r.id, r]));

  const userRoleIds = [guildId, ...(member?.roles ?? [])];
  const perms = userRoleIds.reduce((acc, id) => acc | BigInt(byId.get(id)?.permissions ?? 0), 0n);
  const isAdmin = !!member && (guild.owner_id === userId || (perms & MANAGE) !== 0n);
  const botTopPosition = Math.max(0, ...(botMember?.roles ?? []).map((id) => byId.get(id)?.position ?? 0));

  return { guild, roles, isAdmin, memberRoleIds: member?.roles ?? null, botTopPosition };
}

export async function fetchTextChannels(guildId: string) {
  const channels = (await rest.get(Routes.guildChannels(guildId))) as APIChannel[];
  return channels
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => ("position" in a && "position" in b ? a.position - b.position : 0))
    .map((c) => ({ id: c.id, name: c.name ?? c.id }));
}
