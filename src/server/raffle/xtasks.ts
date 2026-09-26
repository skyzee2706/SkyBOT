import type { Raffle } from "@prisma/client";
import { z } from "zod";
import { intentFollow, intentLike, intentQuote, intentRetweet } from "../x.js";

export const MAX_FOLLOWS = 5;
export const MAX_POSTS = 5;

export type XPost = { tweetId: string; like: boolean; retweet: boolean; quote: boolean };

const xPostSchema = z.object({
  tweetId: z.string().regex(/^\d+$/),
  like: z.boolean(),
  retweet: z.boolean(),
  quote: z.boolean(),
});

type XFields = Pick<Raffle, "xPosts" | "xTweetId" | "xLike" | "xRetweet" | "xQuote">;

// Daftar post task. Raffle lama (sebelum multi-post) disimpan di kolom tunggal, jadi dikonversi di sini.
export function getXPosts(r: XFields): XPost[] {
  const parsed = z.array(xPostSchema).safeParse(r.xPosts);
  if (parsed.success && parsed.data.length) return parsed.data;
  if (r.xTweetId && (r.xLike || r.xRetweet || r.xQuote)) {
    return [{ tweetId: r.xTweetId, like: r.xLike, retweet: r.xRetweet, quote: r.xQuote }];
  }
  return [];
}

export const quotePosts = (r: XFields) => getXPosts(r).filter((p) => p.quote);

export const hasXTasks = (r: XFields & Pick<Raffle, "xFollowUsernames">) =>
  r.xFollowUsernames.length > 0 || getXPosts(r).some((p) => p.like || p.retweet || p.quote);

export type XTaskKind = "follow" | "like" | "retweet" | "quote";
// label = teks tombol di Discord (boleh emoji, dirender Discord); text = teks polos untuk web (ikon dari web sendiri)
export type XTask = { key: string; kind: XTaskKind; label: string; text: string; url: string };

// Semua task X satu per satu. `key` disimpan di TaskProgress.done saat tombolnya dibuka.
export function xTaskList(r: XFields & Pick<Raffle, "xFollowUsernames">): XTask[] {
  const tasks: XTask[] = r.xFollowUsernames.map((u) => ({
    key: `f:${u.toLowerCase()}`,
    kind: "follow",
    label: `Follow @${u}`,
    text: `Follow @${u}`,
    url: intentFollow(u),
  }));
  const posts = getXPosts(r);
  posts.forEach((p, i) => {
    const n = posts.length > 1 ? ` #${i + 1}` : "";
    if (p.like) tasks.push({ key: `p${i}:like`, kind: "like", label: `❤️ Like${n}`, text: `Like${n}`, url: intentLike(p.tweetId) });
    if (p.retweet)
      tasks.push({ key: `p${i}:retweet`, kind: "retweet", label: `🔁 Retweet${n}`, text: `Retweet${n}`, url: intentRetweet(p.tweetId) });
    if (p.quote) tasks.push({ key: `p${i}:quote`, kind: "quote", label: `💬 Quote${n}`, text: `Quote${n}`, url: intentQuote(p.tweetId) });
  });
  return tasks.slice(0, 20); // maks 4 baris tombol task
}
