export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
  return data as T;
}

export async function uploadImage(guildId: string, file: Blob): Promise<string> {
  const res = await fetch(`/api/guilds/${guildId}/images`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`);
  return data.url as string;
}

export type Me = { id: string; username: string; avatar: string | null };
export type GuildSummary = { id: string; name: string; icon: string | null; botPresent: boolean; inviteUrl: string };
export type Role = { id: string; name: string; color: number; assignable: boolean };
export type RaffleStatus = "ACTIVE" | "ENDED" | "CANCELLED";
export type XPost = { tweetId: string; like: boolean; retweet: boolean; quote: boolean };
export type Raffle = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  winnerCount: number;
  gtdCount: number;
  fcfsCount: number;
  chain: string | null;
  hostName: string | null;
  hostAvatar: string | null;
  endsAt: string;
  endedAt: string | null;
  status: RaffleStatus;
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  requireAnyRole: boolean;
  minAccountAgeDays: number;
  walletType: "NONE" | "EVM" | "SOL";
  winnerRoleId: string | null;
  mentionRoleIds: string[];
  xFollowUsernames: string[];
  xPosts: XPost[];
  createdAt: string;
  entryCount?: number;
};
export type GuildDetail = {
  guild: { id: string; name: string; icon: string | null };
  isAdmin: boolean;
  managerRoleIds: string[];
  xEnabled: boolean;
  channels: { id: string; name: string }[];
  roles: Role[];
  raffles: Raffle[];
};
export type Entry = {
  id: string;
  userId: string;
  username: string;
  wallet: string | null;
  xUsername: string | null;
  xQuoteUrls: string[];
  status: "ENTERED" | "WON" | "DISQUALIFIED";
  allocation: "GTD" | "FCFS" | null;
  note: string | null;
  createdAt: string;
};

export const guildIcon = (g: { id: string; icon: string | null }) =>
  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null;

export const avatarUrl = (u: Me) =>
  u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;

// Login Discord lalu kembali ke halaman ini
export const loginUrl = (returnTo: string) => `/api/auth/login?next=${encodeURIComponent(returnTo)}`;
