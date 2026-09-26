import { useRef, useState, type DragEvent } from "react";
import { uploadImage } from "../api";

const MAX_SIDE = 1600;
const MAX_BYTES = 4 * 1024 * 1024;

// Perkecil & kompres gambar di browser sebelum upload (GIF dibiarkan supaya animasinya tetap jalan).
async function compress(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
  if (!blob) return file;
  // Kalau hasil kompres malah lebih besar (jarang), pakai file asli
  return blob.size < file.size || file.size > MAX_BYTES ? blob : file;
}

export function ImageInput({ guildId, value, onChange }: { guildId: string; value: string; onChange: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Please choose an image file (PNG, JPG, GIF or WebP).");
    setBusy(true);
    try {
      const blob = await compress(file);
      if (blob.size > MAX_BYTES) throw new Error("Image is too large (max 4 MB after compression).");
      onChange(await uploadImage(guildId, blob));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <div className="mb-2 flex gap-1 text-xs">
        {(["upload", "link"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {m === "upload" ? "Upload" : "Paste link"}
          </button>
        ))}
      </div>

      {value ? (
        <div className="flex items-start gap-3">
          <img src={value} alt="" className="h-28 w-28 rounded-lg border border-zinc-800 object-cover" />
          <div className="flex flex-col gap-2">
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => (mode === "upload" ? fileRef.current?.click() : onChange(""))}>
              {mode === "upload" ? "Replace" : "Change link"}
            </button>
            <button type="button" className="text-left text-xs text-red-400 hover:underline" onClick={() => onChange("")}>
              Remove
            </button>
          </div>
        </div>
      ) : mode === "upload" ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition ${
            dragging ? "border-brand-500 bg-brand-500/10" : "border-zinc-700 hover:border-zinc-500"
          }`}
        >
          {busy ? (
            <span className="text-zinc-400">Uploading...</span>
          ) : (
            <>
              <span className="text-zinc-300">Click to upload or drag & drop</span>
              <span className="mt-1 text-xs text-zinc-500">PNG, JPG, GIF or WebP — resized automatically</span>
            </>
          )}
        </div>
      ) : (
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://..." />
      )}

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
