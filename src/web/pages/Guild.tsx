import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, guildIcon, type GuildDetail } from "../api";
import { ErrorBox, formatDate, Loading, Pagination, RolePicker, StatusBadge } from "../components";
import { allocationSummary, chainLabel } from "../../shared/raffle";
import { ArrowLeft, ChevronDown, Settings } from "lucide-react";

// Hanya tampil untuk admin: pilih role (mis. @CM) yang boleh mengelola raffle di web.
function ManagerRolesPanel({ data }: { data: GuildDetail }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(data.managerRoleIds);
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    setStatus("Saving...");
    try {
      const r = await api<{ managerRoleIds: string[] }>(`/guilds/${data.guild.id}/settings`, {
        method: "PUT",
        body: { managerRoleIds: value },
      });
      setValue(r.managerRoleIds);
      setStatus("Saved");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="card mb-6">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <Settings className="h-4 w-4 text-zinc-400" /> Raffle manager roles
        </span>
        <span className="text-sm text-zinc-400">
          {value.length ? `${value.length} role${value.length > 1 ? "s" : ""}` : "Not set"} <ChevronDown className={`inline h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="hint">
            Members with these roles can log in to the web app and create / manage raffles without the Manage Server
            permission.
          </p>
          <RolePicker roles={data.roles} value={value} onChange={setValue} />
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={save}>
              Save
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
  // Nomor halaman di URL (?page=2) supaya tombol Back kembali ke halaman yang sama
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);

  useEffect(() => {
    api<GuildDetail>(`/guilds/${guildId}?page=${page}`)
      .then((d) => {
        setData(d);
        if (page > d.rafflePage.totalPages) setParams({}, { replace: true }); // halaman sudah tidak ada
      })
      .catch((e) => setError(e.message));
  }, [guildId, page, setParams]);

  const goTo = (p: number) => {
    setParams(p === 1 ? {} : { page: String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const icon = guildIcon(data.guild);
  const channelName = (id: string) => data.channels.find((c) => c.id === id)?.name ?? "channel";

  return (
    <div>
      <Link to="/manage" className="mb-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="mr-1 inline h-4 w-4" />
        All servers
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <img src={icon} className="h-12 w-12 rounded-xl" alt="" />}
          <h1 className="text-2xl font-bold">{data.guild.name}</h1>
        </div>
        <Link to={`/manage/${guildId}/new`} className="btn btn-primary">
          + Create Raffle
        </Link>
      </div>

      {data.isAdmin && <ManagerRolesPanel data={data} />}

      {data.raffles.length === 0 ? (
        <div className="card text-center text-zinc-400">No raffles yet. Click “Create Raffle” to get started.</div>
      ) : (
        <div className="space-y-3">
          {data.raffles.map((r) => (
            <Link
              key={r.id}
              to={`/manage/${guildId}/raffle/${r.id}`}
              className="card flex flex-wrap items-center gap-4 transition hover:border-brand-500/50"
            >
              {r.imageUrl && <img src={r.imageUrl} className="h-14 w-14 rounded-lg object-cover" alt="" />}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-xs text-zinc-500">
                  #{channelName(r.channelId)} · {allocationSummary(r)}
                  {chainLabel(r.chain) && ` · ${chainLabel(r.chain)}`} ·{" "}
                  {r.status === "ACTIVE" ? "ends" : "ended"} {formatDate(r.endedAt ?? r.endsAt)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold">{r.entryCount ?? 0}</div>
                <div className="text-xs text-zinc-500">entries</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination page={data.rafflePage.page} totalPages={data.rafflePage.totalPages} onChange={goTo} className="mt-6" />
    </div>
  );
}
