import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type GuildDetail, type Raffle } from "../api";
import { ErrorBox, Field, Loading, RolePicker } from "../components";
import { cleanUsername, emptyXTasks, XTasksEditor, type XTasksValue } from "./XTasksEditor";
import { ImageInput } from "./ImageInput";
import { ALLOCATIONS, CHAIN_IDS, CHAINS, CUSTOM_CHAIN_MAX, normalizeChain, type ChainId } from "../../shared/raffle";
import { ArrowLeft } from "lucide-react";
import { DiscordMarkdown } from "../DiscordMarkdown";

const OTHER = "__other__";

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
    // Allocations: centang GTD dan/atau FCFS, masing-masing dengan jumlah slot
    gtd: { on: true, count: 1 },
    fcfs: { on: false, count: 1 },
    chain: "" as "" | ChainId | typeof OTHER, // wajib
    customChain: "", // diisi kalau pilih "Other"
    endsAt: toLocalInput(new Date(Date.now() + 24 * 3_600_000)),
    requiredRoleIds: [] as string[],
    requireMember: true, // peserta wajib member server
    inviteUrl: "",
    minAccountAgeDays: 0,
    winnerRoleId: "",
    mentionRoleIds: [guildId!] as string[], // default: @everyone
    x: emptyXTasks as XTasksValue,
  });
  type ErrorKey = keyof typeof form | "allocations";
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    const key: ErrorKey = k === "gtd" || k === "fcfs" ? "allocations" : k;
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };
  const chainValue = form.chain === OTHER ? normalizeChain(form.customChain) : form.chain;
  const allocationTotal = () => (form.gtd.on ? form.gtd.count : 0) + (form.fcfs.on ? form.fcfs.count : 0);

  // Field wajib: kosong = tidak bisa dikirim ke Discord, field-nya ditandai merah.
  const validate = () => {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = "Title is required";
    if (!form.channelId) e.channelId = "Please choose a channel";
    if (!form.chain) e.chain = "Please choose a chain";
    const invite = form.inviteUrl.trim();
    if (form.requireMember && invite && !/^(https?:\/\/)?(www\.)?(discord\.gg|discord(app)?\.com\/invite)\/[A-Za-z0-9-]{2,32}\/?$/i.test(invite)) {
      e.inviteUrl = "Invalid Discord invite link (e.g. https://discord.gg/abc123)";
    }
    else if (form.chain === OTHER && !form.customChain.trim()) e.chain = "Type the chain name";
    const picked = ALLOCATIONS.filter((a) => form[a === "GTD" ? "gtd" : "fcfs"].on);
    const bad = picked.find((a) => {
      const n = form[a === "GTD" ? "gtd" : "fcfs"].count;
      return !Number.isInteger(n) || n < 1;
    });
    if (!picked.length) e.allocations = "Choose GTD, FCFS, or both";
    else if (bad) e.allocations = `${bad} needs at least 1 spot`;
    else if (allocationTotal() > 1000) e.allocations = "Maximum 1000 allocations in total";
    const end = new Date(form.endsAt).getTime();
    if (!form.endsAt || Number.isNaN(end)) e.endsAt = "End time is required";
    else if (end <= Date.now() + 60_000) e.endsAt = "End time must be at least 1 minute from now";
    return e;
  };

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
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setError("Please fill in the required fields marked in red.");
      requestAnimationFrame(() => document.querySelector("[data-invalid]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    setSaving(true);
    try {
      const { x, gtd, fcfs, chain: _chain, customChain: _custom, ...rest } = form;
      const raffle = await api<Raffle>(`/guilds/${guildId}/raffles`, {
        body: {
          ...rest,
          chain: chainValue,
          inviteUrl: form.requireMember ? form.inviteUrl.trim() : "",
          gtdCount: gtd.on ? gtd.count : 0,
          fcfsCount: fcfs.on ? fcfs.count : 0,
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
      <Link to={`/server/${guildId}`} className="mb-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="mr-1 inline h-4 w-4" />
        {data.guild.name}
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Create Raffle</h1>
      <ErrorBox error={error} />

      <form onSubmit={submit} noValidate className="space-y-6">
        <section className="card space-y-4">
          <h2 className="font-semibold">Raffle Info</h2>
          <Field label="Title" required error={errors.title}>
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
          </Field>
          <Field label="Description" hint="Discord formatting: **bold**, *italic*, __underline__, ~~strike~~, # heading, - list, > quote, [link](https://...).">
            <textarea
              className="input min-h-24"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={3000}
            />
          </Field>
          {form.description.trim() && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-brand-300/80">Preview</div>
              <DiscordMarkdown text={form.description} />
            </div>
          )}
          <Field label="Image (optional)">
            <ImageInput guildId={guildId!} value={form.imageUrl} onChange={(url) => set("imageUrl", url)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel" required error={errors.channelId}>
              <select className="input" value={form.channelId} onChange={(e) => set("channelId", e.target.value)} required>
                <option value="" disabled>
                  Choose a channel
                </option>
                {data.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chain" required error={errors.chain}>
              <select className="input" value={form.chain} onChange={(e) => set("chain", e.target.value as typeof form.chain)}>
                <option value="" disabled>
                  Choose a chain
                </option>
                {CHAIN_IDS.map((c) => (
                  <option key={c} value={c}>
                    {CHAINS[c].label}
                  </option>
                ))}
                <option value={OTHER}>Other (type manually)</option>
              </select>
              {form.chain === OTHER && (
                <input
                  className="input mt-2"
                  placeholder="Chain name, e.g. Monad"
                  maxLength={CUSTOM_CHAIN_MAX}
                  value={form.customChain}
                  onChange={(e) => {
                    set("customChain", e.target.value);
                    setErrors((er) => (er.chain ? { ...er, chain: undefined } : er));
                  }}
                  autoFocus
                />
              )}
            </Field>
          </div>
          <Field
            label="Allocations"
            required
            error={errors.allocations}
            hint="Pick GTD, FCFS, or both. With both, GTD winners are drawn first, then FCFS from the remaining entrants."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {ALLOCATIONS.map((a) => {
                const key = a === "GTD" ? "gtd" : "fcfs";
                const v = form[key];
                return (
                  <label
                    key={a}
                    className={`input flex cursor-pointer items-center gap-3 ${v.on ? "border-brand-500/70" : ""}`}
                  >
                    <input type="checkbox" checked={v.on} onChange={(e) => set(key, { ...v, on: e.target.checked })} />
                    <span className="w-12 font-medium">{a}</span>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      aria-label={`${a} spots`}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 disabled:opacity-40"
                      value={v.count}
                      disabled={!v.on}
                      onChange={(e) => set(key, { ...v, count: Number(e.target.value) })}
                    />
                    <span className="text-xs text-zinc-500">spots</span>
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="End Time" hint="Uses your computer's time zone." required error={errors.endsAt}>
            <input type="datetime-local" className="input" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} required />
          </Field>
          <Field
            label="Mention when posted"
            hint="Pinged once in the NEW RAFFLE announcement. The bot needs the Mention @everyone permission to ping @everyone or non-mentionable roles."
          >
            <RolePicker
              roles={[{ id: guildId!, name: "everyone", color: 0, assignable: false }, ...data.roles]}
              value={form.mentionRoleIds}
              onChange={(v) => set("mentionRoleIds", v)}
            />
          </Field>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Discord Requirements</h2>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.requireMember}
              onChange={(e) => {
                set("requireMember", e.target.checked);
                if (!e.target.checked) set("requiredRoleIds", []); // role hanya bisa dicek untuk member
              }}
            />
            <span>
              <span className="block text-sm font-medium">Entrants must be members of {data.guild.name}</span>
              <span className="hint block">
                {form.requireMember
                  ? "Non-members can still view the raffle on the web, but must join the server to enter."
                  : "Anyone with a Discord account can enter on the web page, even without joining the server."}
              </span>
            </span>
          </label>
          {form.requireMember && (
            <Field
              label="Server invite link (optional)"
              hint="Shown as a “Join server” button to visitors who aren't members yet. Use a link that doesn't expire."
              error={errors.inviteUrl}
            >
              <input
                className="input"
                placeholder="https://discord.gg/yourserver"
                value={form.inviteUrl}
                onChange={(e) => set("inviteUrl", e.target.value)}
              />
            </Field>
          )}
          <Field
            label="Required roles (optional)"
            hint={
              form.requireMember
                ? "Entrants need at least ONE of the selected roles. Leave empty = any member can join."
                : "Roles can only be checked for server members. Turn on “must be members” to use this."
            }
          >
            {form.requireMember ? (
              <RolePicker roles={data.roles} value={form.requiredRoleIds} onChange={(v) => set("requiredRoleIds", v)} />
            ) : (
              <div className="input text-zinc-500">Not available for raffles open to non-members</div>
            )}
          </Field>
          <Field label="Minimum Discord account age (days)" hint="0 = no limit. Helps block alt accounts.">
            <input
              type="number"
              min={0}
              className="input sm:max-w-xs"
              value={form.minAccountAgeDays}
              onChange={(e) => set("minAccountAgeDays", Number(e.target.value))}
            />
          </Field>
          <p className="hint">Role requirements are checked on entry AND re-checked when winners are drawn.</p>
        </section>

        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">X (Twitter) Tasks</h2>
            <p className="hint">
              Entrants connect their X account, then complete the tasks via buttons.
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
          <Field label="Give winners a role (optional)" hint="The role must be below the bot's role in Server Settings > Roles.">
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
