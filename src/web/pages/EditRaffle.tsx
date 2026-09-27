import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api, type Raffle } from "../api";
import { Field } from "../components";
import { DiscordMarkdown } from "../DiscordMarkdown";
import { ImageInput } from "./ImageInput";

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// Edit raffle yang masih berjalan: judul, deskripsi, gambar, waktu selesai.
// Syarat & allocation sengaja tidak bisa diubah supaya adil bagi yang sudah ikut.
export function EditRaffleDialog({ raffle, onClose, onSaved }: { raffle: Raffle; onClose: () => void; onSaved: () => void }) {
  const initialEndsAt = toLocalInput(new Date(raffle.endsAt));
  const [form, setForm] = useState({
    title: raffle.title,
    description: raffle.description,
    imageUrl: raffle.imageUrl ?? "",
    endsAt: initialEndsAt,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError("Title is required");
    // Waktu selesai hanya dikirim kalau diubah (input hanya sampai menit, jadi jangan membulatkan waktu aslinya)
    const endChanged = form.endsAt !== initialEndsAt;
    const end = new Date(form.endsAt).getTime();
    if (endChanged && (Number.isNaN(end) || end <= Date.now() + 60_000)) return setError("End time must be at least 1 minute from now");
    setBusy(true);
    setError(null);
    try {
      await api(`/raffles/${raffle.id}`, {
        method: "PATCH",
        body: {
          title: form.title,
          description: form.description,
          imageUrl: form.imageUrl,
          ...(endChanged ? { endsAt: new Date(end).toISOString() } : {}),
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" onSubmit={save} className="card mx-auto my-8 max-w-2xl space-y-4 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit raffle</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Field label="Title" required>
          <input className="input" value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Description" hint="Supports Discord formatting.">
          <textarea className="input min-h-32" value={form.description} maxLength={3000} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {form.description.trim() && (
          <div className="rounded-lg border border-zinc-800 p-3">
            <DiscordMarkdown text={form.description} />
          </div>
        )}
        <Field label="Image">
          <ImageInput guildId={raffle.guildId} value={form.imageUrl} onChange={(v) => set("imageUrl", v)} />
        </Field>
        <Field label="End Time" hint="Uses your computer's time zone." required>
          <input type="datetime-local" className="input" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
        </Field>
        <p className="hint">Requirements, allocations and X tasks can't be changed after posting, to keep it fair for people who already entered.</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
