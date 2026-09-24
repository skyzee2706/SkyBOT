import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type GuildDetail, type Raffle } from "../api";
import { ErrorBox, Field, Loading, RolePicker } from "../components";
import { cleanUsername, emptyXTasks, XTasksEditor, type XTasksValue } from "./XTasksEditor";
import { ImageInput } from "./ImageInput";

// Nilai default untuk <input type="datetime-local"> (waktu lokal browser)
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);


export function CreateRafflePage() {
  const { guildId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<GuildDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    imageUrl: "",
    channelId: "",
    winnerCount: 1,
    endsAt: toLocalInput(new Date(Date.now() + 24 * 3_600_000)),
    requiredRoleIds: [] as string[],
    blockedRoleIds: [] as string[],
    minAccountAgeDays: 0,
    walletType: "NONE" as "NONE" | "EVM" | "SOL",
    winnerRoleId: "",
    x: emptyXTasks as XTasksValue,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api<GuildDetail>(`/guilds/${guildId}`)
      .then((d) => {
        setData(d);
        if (d.channels[0]) setForm((f) => ({ ...f, channelId: d.channels[0].id }));
      })
      .catch((e) => setError(e.message));
  }, [guildId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { x, ...rest } = form;
      const raffle = await api<Raffle>(`/guilds/${guildId}/raffles`, {
        body: {
          ...rest,
          endsAt: new Date(form.endsAt).toISOString(),
          xFollowUsernames: x.follows.map(cleanUsername).filter(Boolean),
          xPosts: x.posts,
        },
      });
      navigate(`/r/${raffle.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={`/g/${guildId}`} className="mb-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        ← {data.guild.name}
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Create Raffle</h1>
      <ErrorBox error={error} />

      <form onSubmit={submit} className="space-y-6">
        <section className="card space-y-4">
          <h2 className="font-semibold">Raffle Info</h2>
          <Field label="Title">
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
          </Field>
          <Field label="Description" hint="Supports Discord formatting (**bold**, links, etc).">
            <textarea
              className="input min-h-24"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={3000}
            />
          </Field>
          <Field label="Image (optional)">
            <ImageInput guildId={guildId!} value={form.imageUrl} onChange={(url) => set("imageUrl", url)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel">
              <select className="input" value={form.channelId} onChange={(e) => set("channelId", e.target.value)} required>
                {data.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Number of Winners">
              <input
                type="number"
                min={1}
                max={1000}
                className="input"
                value={form.winnerCount}
                onChange={(e) => set("winnerCount", Number(e.target.value))}
                required
              />
            </Field>
          </div>
          <Field label="End Time" hint="Uses your computer's time zone.">
            <input type="datetime-local" className="input" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} required />
          </Field>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Discord Requirements</h2>
          <Field label="Required roles" hint="Entrants must have ALL selected roles.">
            <RolePicker roles={data.roles} value={form.requiredRoleIds} onChange={(v) => set("requiredRoleIds", v)} />
          </Field>
          <Field label="Blocked roles" hint="Members with any of these roles can't enter.">
            <RolePicker roles={data.roles} value={form.blockedRoleIds} onChange={(v) => set("blockedRoleIds", v)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum Discord account age (days)" hint="0 = no limit. Helps block alt accounts.">
              <input
                type="number"
                min={0}
                className="input"
                value={form.minAccountAgeDays}
                onChange={(e) => set("minAccountAgeDays", Number(e.target.value))}
              />
            </Field>
            <Field label="Wallet submission">
              <select className="input" value={form.walletType} onChange={(e) => set("walletType", e.target.value as typeof form.walletType)}>
                <option value="NONE">Not required</option>
                <option value="EVM">EVM (Ethereum, Base, etc)</option>
                <option value="SOL">Solana</option>
              </select>
            </Field>
          </div>
          <p className="hint">Role requirements are checked on entry AND re-checked when winners are drawn.</p>
        </section>

        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">X (Twitter) Tasks</h2>
            <p className="hint">
              Entrants connect their X account, then complete the tasks via buttons. Tasks are <b>not verified
              automatically</b> — check winners manually using their X username on the raffle page.
            </p>
          </div>
          {!data.xEnabled ? (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
              X tasks are not enabled yet. The admin needs to set X_API_KEY and X_API_SECRET in Vercel.
            </p>
          ) : (
            <XTasksEditor value={form.x} onChange={(v) => set("x", v)} />
          )}
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Reward</h2>
          <Field label="Give winners a role (optional)" hint="The role must be below the bot's role in Server Settings → Roles.">
            <select className="input" value={form.winnerRoleId} onChange={(e) => set("winnerRoleId", e.target.value)}>
              <option value="">— None —</option>
              {data.roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.assignable}>
                  @{r.name}
                  {!r.assignable ? " (bot can't assign this role)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <button className="btn btn-primary w-full py-3" disabled={saving}>
          {saving ? "Posting to Discord..." : "Create & Post to Discord"}
        </button>
      </form>
    </div>
  );
}
