const MAX_FOLLOWS = 5;
const MAX_POSTS = 5;

export type PostInput = { url: string; like: boolean; retweet: boolean; quote: boolean };
export type XTasksValue = { follows: string[]; posts: PostInput[] };

export const emptyXTasks: XTasksValue = { follows: [""], posts: [] };
const emptyPost: PostInput = { url: "", like: true, retweet: true, quote: false };

export const cleanUsername = (s: string) =>
  s.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?]/)[0];

const tweetIdFrom = (s: string) => s.match(/status(?:es)?\/(\d+)/)?.[1] ?? (/^\d+$/.test(s.trim()) ? s.trim() : null);

const intent = {
  follow: (u: string) => `https://x.com/intent/follow?screen_name=${encodeURIComponent(u)}`,
  like: (id: string) => `https://x.com/intent/like?tweet_id=${id}`,
  retweet: (id: string) => `https://x.com/intent/retweet?tweet_id=${id}`,
  quote: (id: string) => `https://x.com/intent/post?url=${encodeURIComponent(`https://x.com/i/status/${id}`)}`,
};

// Preview tombol task yang akan dilihat peserta di Discord.
function TaskPreview({ value }: { value: XTasksValue }) {
  const tasks = value.follows
    .map(cleanUsername)
    .filter(Boolean)
    .map((u) => ({ label: `Follow @${u}`, url: intent.follow(u) }));
  const posts = value.posts.map((p) => ({ ...p, id: tweetIdFrom(p.url) })).filter((p) => p.id);
  posts.forEach((p, i) => {
    const n = posts.length > 1 ? ` #${i + 1}` : "";
    if (p.like) tasks.push({ label: `❤️ Like${n}`, url: intent.like(p.id!) });
    if (p.retweet) tasks.push({ label: `🔁 Retweet${n}`, url: intent.retweet(p.id!) });
    if (p.quote) tasks.push({ label: `💬 Quote${n}`, url: intent.quote(p.id!) });
  });
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-2 text-xs text-zinc-500">Task buttons entrants will see in Discord (click to test):</p>
      <div className="flex flex-wrap gap-2">
        {tasks.map((t) => (
          <a key={t.label} href={t.url} target="_blank" rel="noreferrer" className="btn btn-ghost px-3 py-1.5 text-xs">
            {t.label} ↗
          </a>
        ))}
      </div>
      {posts.some((p) => p.quote) && (
        <p className="mt-2 text-xs text-zinc-500">
          After quoting, entrants must paste each quote link. Links must come from their connected X account.
        </p>
      )}
    </div>
  );
}

export function XTasksEditor({ value, onChange }: { value: XTasksValue; onChange: (v: XTasksValue) => void }) {
  const setFollow = (i: number, v: string) => onChange({ ...value, follows: value.follows.map((f, j) => (j === i ? v : f)) });
  const removeFollow = (i: number) => onChange({ ...value, follows: value.follows.filter((_, j) => j !== i) });
  const setPost = (i: number, patch: Partial<PostInput>) =>
    onChange({ ...value, posts: value.posts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const removePost = (i: number) => onChange({ ...value, posts: value.posts.filter((_, j) => j !== i) });

  return (
    <div className="space-y-5">
      <div>
        <label className="label">Accounts to follow</label>
        <div className="space-y-2">
          {value.follows.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input className="input" value={f} onChange={(e) => setFollow(i, e.target.value)} placeholder="@username or profile link" />
              <button type="button" className="btn btn-ghost px-3" onClick={() => removeFollow(i)} aria-label="Remove account">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost mt-2 px-3 py-1.5 text-xs"
          disabled={value.follows.length >= MAX_FOLLOWS}
          onClick={() => onChange({ ...value, follows: [...value.follows, ""] })}
        >
          + Add account {value.follows.length >= MAX_FOLLOWS && `(max ${MAX_FOLLOWS})`}
        </button>
      </div>

      <div>
        <label className="label">Post tasks</label>
        <div className="space-y-3">
          {value.posts.map((p, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Post #{i + 1}</span>
                <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => removePost(i)}>
                  Remove
                </button>
              </div>
              <input
                className="input mb-2"
                value={p.url}
                onChange={(e) => setPost(i, { url: e.target.value })}
                placeholder="https://x.com/name/status/1234567890"
                required
              />
              <div className="flex flex-wrap gap-5 text-sm">
                {(["like", "retweet", "quote"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" checked={p[k]} onChange={(e) => setPost(i, { [k]: e.target.checked })} />
                    {k === "like" ? "Like" : k === "retweet" ? "Retweet" : "Quote"}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost mt-2 px-3 py-1.5 text-xs"
          disabled={value.posts.length >= MAX_POSTS}
          onClick={() => onChange({ ...value, posts: [...value.posts, { ...emptyPost }] })}
        >
          + Add post {value.posts.length >= MAX_POSTS && `(max ${MAX_POSTS})`}
        </button>
        <p className="hint">Quote posts + wallet submission can't exceed 5 in total (Discord form limit).</p>
      </div>

      <TaskPreview value={value} />
    </div>
  );
}
