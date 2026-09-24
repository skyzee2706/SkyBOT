import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, guildIcon, type GuildDetail } from "../api";
import { ErrorBox, formatDate, Loading, RolePicker, StatusBadge } from "../components";

// Hanya tampil untuk admin: pilih role (mis. @CM) yang boleh mengelola raffle di web.
function ManagerRolesPanel({ data }: { data: GuildDetail }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(data.managerRoleIds);
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    setStatus("Menyimpan...");
    try {
      const r = await api<{ managerRoleIds: string[] }>(`/guilds/${data.guild.id}/settings`, {
        method: "PUT",
        body: { managerRoleIds: value },
      });
      setValue(r.managerRoleIds);
      setStatus("✅ Tersimpan");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="card mb-6">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="font-semibold">⚙️ Role pengelola raffle</span>
        <span className="text-sm text-zinc-400">
          {value.length ? `${value.length} role` : "Belum diatur"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="hint">
            Member dengan role ini bisa login ke web dan membuat / mengelola raffle tanpa permission Manage Server.
          </p>
          <RolePicker roles={data.roles} value={value} onChange={setValue} />
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={save}>
              Simpan
            </button>
            {status && <span className="text-sm text-zinc-400">{status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function GuildPage() {
  const { guildId } = useParams();
  const [data, setData] = useState<GuildDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GuildDetail>(`/guilds/${guildId}`).then(setData).catch((e) => setError(e.message));
  }, [guildId]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const icon = guildIcon(data.guild);
  const channelName = (id: string) => data.channels.find((c) => c.id === id)?.name ?? "channel";

  return (
    <div>
      <Link to="/" className="mb-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        ← Semua server
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <img src={icon} className="h-12 w-12 rounded-xl" alt="" />}
          <h1 className="text-2xl font-bold">{data.guild.name}</h1>
        </div>
        <Link to={`/g/${guildId}/new`} className="btn btn-primary">
          + Buat Raffle
        </Link>
      </div>

      {data.isAdmin && <ManagerRolesPanel data={data} />}

      {data.raffles.length === 0 ? (
        <div className="card text-center text-zinc-400">Belum ada raffle. Klik “Buat Raffle” untuk mulai.</div>
      ) : (
        <div className="space-y-3">
          {data.raffles.map((r) => (
            <Link
              key={r.id}
              to={`/r/${r.id}`}
              className="card flex flex-wrap items-center gap-4 transition hover:border-zinc-600"
            >
              {r.imageUrl && <img src={r.imageUrl} className="h-14 w-14 rounded-lg object-cover" alt="" />}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-xs text-zinc-500">
                  #{channelName(r.channelId)} · {r.winnerCount} pemenang · berakhir {formatDate(r.endsAt)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold">{r.entryCount ?? 0}</div>
                <div className="text-xs text-zinc-500">peserta</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
