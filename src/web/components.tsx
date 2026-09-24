import type { ReactNode } from "react";
import type { RaffleStatus, Role } from "./api";

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>;
}

export function Loading() {
  return <div className="py-10 text-center text-zinc-500">Memuat...</div>;
}

const STATUS: Record<RaffleStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "Aktif", cls: "bg-indigo-500/15 text-indigo-300" },
  ENDED: { label: "Selesai", cls: "bg-emerald-500/15 text-emerald-300" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-zinc-700/40 text-zinc-400" },
};

export function StatusBadge({ status }: { status: RaffleStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

export const roleColor = (color: number) => (color ? `#${color.toString(16).padStart(6, "0")}` : "#a1a1aa");

export function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  if (roles.length === 0) return <p className="hint">Server ini belum punya role.</p>;
  return (
    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-lg border border-zinc-800 p-2">
      {roles.map((r) => {
        const on = value.includes(r.id);
        return (
          <button
            type="button"
            key={r.id}
            onClick={() => toggle(r.id)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              on ? "border-indigo-500 bg-indigo-500/20" : "border-zinc-700 hover:border-zinc-500"
            }`}
            style={{ color: roleColor(r.color) }}
          >
            @{r.name}
          </button>
        );
      })}
    </div>
  );
}
