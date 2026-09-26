import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RaffleStatus, Role } from "./api";
import { Check, ChevronDown, X } from "lucide-react";

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>;
}

export function Loading() {
  return <div className="py-10 text-center text-zinc-500">Loading...</div>;
}

const STATUS: Record<RaffleStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30" },
  ENDED: { label: "Ended", cls: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30" },
  CANCELLED: { label: "Cancelled", cls: "bg-zinc-700/40 text-zinc-400" },
};

export function StatusBadge({ status }: { status: RaffleStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean; // tampilkan * merah
  error?: string; // border merah + pesan di bawah field
  children: ReactNode;
}) {
  return (
    <div data-invalid={error ? true : undefined} className={error ? "[&_.input]:border-red-500" : undefined}>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export const roleColor = (color: number) => (color ? `#${color.toString(16).padStart(6, "0")}` : "#a1a1aa");

// Dropdown pilih banyak role: tertutup dulu, daftar role muncul saat diklik (ada kolom cari).
export function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (roles.length === 0) return <p className="hint">This server has no roles yet.</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const selected = roles.filter((r) => value.includes(r.id));
  const q = query.trim().toLowerCase();
  const shown = q ? roles.filter((r) => r.name.toLowerCase().includes(q)) : roles;

  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((o) => !o))}
        className="input flex min-h-10 cursor-pointer items-center gap-2"
      >
        <div className="flex flex-1 flex-wrap gap-1.5">
          {selected.length === 0 && <span className="text-zinc-500">Select roles...</span>}
          {selected.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1 rounded-full border border-brand-500 bg-brand-500/20 px-2 py-0.5 text-xs"
              style={{ color: roleColor(r.color) }}
            >
              @{r.name}
              <button
                type="button"
                aria-label={`Remove @${r.name}`}
                className="text-zinc-400 hover:text-zinc-100"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(r.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
          <input
            autoFocus
            className="input mb-2"
            placeholder="Search roles..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto">
            {shown.length === 0 && <p className="hint px-2 py-1">No roles found.</p>}
            {shown.map((r) => {
              const on = value.includes(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => toggle(r.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800 ${
                    on ? "bg-brand-500/10" : ""
                  }`}
                >
                  <span style={{ color: roleColor(r.color) }}>@{r.name}</span>
                  {on && <Check className="h-4 w-4 text-brand-400" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
