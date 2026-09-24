import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type GuildDetail, type Raffle } from "../api";
import { ErrorBox, Field, Loading, RolePicker } from "../components";

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
    xFollow: "",
    xTweetUrl: "",
    xLike: false,
    xRetweet: false,
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
      const raffle = await api<Raffle>(`/guilds/${guildId}/raffles`, {
        body: {
          ...form,
          endsAt: new Date(form.endsAt).toISOString(),
          xFollowUsernames: form.xFollow.split(/[\s,]+/).filter(Boolean),
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
      <h1 className="mb-6 text-2xl font-bold">Buat Raffle</h1>
      <ErrorBox error={error} />

      <form onSubmit={submit} className="space-y-6">
        <section className="card space-y-4">
          <h2 className="font-semibold">Info Raffle</h2>
          <Field label="Judul">
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
          </Field>
          <Field label="Deskripsi" hint="Mendukung format Discord (**tebal**, link, dll).">
            <textarea
              className="input min-h-24"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={3000}
            />
          </Field>
          <Field label="URL Gambar (opsional)" hint="Link langsung ke gambar, mis. dari Discord atau Imgur.">
            <input className="input" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://..." />
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
            <Field label="Jumlah Pemenang">
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
          <Field label="Waktu Selesai" hint="Pakai zona waktu komputer kamu.">
            <input type="datetime-local" className="input" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} required />
          </Field>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Syarat Peserta</h2>
          <Field label="Wajib punya role" hint="Peserta harus punya SEMUA role yang dipilih.">
            <RolePicker roles={data.roles} value={form.requiredRoleIds} onChange={(v) => set("requiredRoleIds", v)} />
          </Field>
          <Field label="Role yang dilarang ikut">
            <RolePicker roles={data.roles} value={form.blockedRoleIds} onChange={(v) => set("blockedRoleIds", v)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Umur akun Discord minimal (hari)" hint="0 = tanpa batas. Bagus untuk cegah akun alt.">
              <input
                type="number"
                min={0}
                className="input"
                value={form.minAccountAgeDays}
                onChange={(e) => set("minAccountAgeDays", Number(e.target.value))}
              />
            </Field>
            <Field label="Wajib submit wallet">
              <select className="input" value={form.walletType} onChange={(e) => set("walletType", e.target.value as typeof form.walletType)}>
                <option value="NONE">Tidak perlu</option>
                <option value="EVM">EVM (Ethereum, Base, dll)</option>
                <option value="SOL">Solana</option>
              </select>
            </Field>
          </div>
          <p className="hint">Syarat role dicek saat peserta masuk DAN dicek ulang saat undian.</p>
        </section>

        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">Task X (Twitter)</h2>
            <p className="hint">
              Peserta harus menghubungkan akun X, lalu klik tombol task. Task <b>tidak dicek otomatis</b> — cek manual
              pemenang lewat username X di halaman raffle.
            </p>
          </div>
          {!data.xEnabled ? (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
              Fitur X belum aktif. Admin perlu mengisi X_API_KEY dan X_API_SECRET di Vercel.
            </p>
          ) : (
            <>
              <Field label="Akun yang wajib di-follow" hint="Pisahkan dengan koma atau spasi, maks 5. Contoh: @komunitas, @partner">
                <input className="input" value={form.xFollow} onChange={(e) => set("xFollow", e.target.value)} placeholder="@username" />
              </Field>
              <Field label="Link post X untuk Like / Retweet" hint="Contoh: https://x.com/nama/status/1234567890">
                <input className="input" value={form.xTweetUrl} onChange={(e) => set("xTweetUrl", e.target.value)} placeholder="https://x.com/..." />
              </Field>
              <div className="flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.xLike} onChange={(e) => set("xLike", e.target.checked)} /> Wajib Like
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.xRetweet} onChange={(e) => set("xRetweet", e.target.checked)} /> Wajib Retweet
                </label>
              </div>
            </>
          )}
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Hadiah</h2>
          <Field label="Beri role ke pemenang (opsional)" hint="Role harus berada di bawah role bot di pengaturan server.">
            <select className="input" value={form.winnerRoleId} onChange={(e) => set("winnerRoleId", e.target.value)}>
              <option value="">— Tidak ada —</option>
              {data.roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.assignable}>
                  @{r.name}
                  {!r.assignable ? " (bot tidak bisa memberi role ini)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <button className="btn btn-primary w-full py-3" disabled={saving}>
          {saving ? "Mengirim ke Discord..." : "Buat & Kirim ke Discord"}
        </button>
      </form>
    </div>
  );
}
