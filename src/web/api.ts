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

export type Me = { id: string; username: string; avatar: string | null };
export type GuildSummary = { id: string; name: string; icon: string | null; botPresent: boolean; inviteUrl: string };
export type Role = { id: string; name: string; color: number; assignable: boolean };
export type RaffleStatus = "ACTIVE" | "ENDED" | "CANCELLED";
export type Raffle = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  winnerCount: number;
  endsAt: string;
  endedAt: string | null;
  status: RaffleStatus;
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  minAccountAgeDays: number;
  walletType: "NONE" | "EVM" | "SOL";
  winnerRoleId: string | null;
  xFollowUsernames: string[];
  xTweetId: string | null;
  xLike: boolean;
  xRetweet: boolean;
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
  status: "ENTERED" | "WON" | "DISQUALIFIED";
  note: string | null;
  createdAt: string;
};

export const guildIcon = (g: { id: string; icon: string | null }) =>
  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null;

export const avatarUrl = (u: Me) =>
  u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;
