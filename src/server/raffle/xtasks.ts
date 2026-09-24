import type { Raffle } from "@prisma/client";
import { z } from "zod";

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
