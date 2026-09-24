// Entry point Vercel Function — semua request /api/* diarahkan ke sini (lihat vercel.json).
import type { IncomingMessage, ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// Dimuat secara dinamis supaya kalau server gagal start (mis. env belum diisi),
// pesan error-nya tampil di browser, bukan hanya "FUNCTION_INVOCATION_FAILED".
// Error langsung ditangkap di sini supaya tidak jadi unhandled rejection yang mematikan proses.
const loaded: Promise<{ app: Handler } | { error: unknown }> = import("../src/server/app.js").then(
  (m) => ({ app: m.default as unknown as Handler }),
  (error) => ({ error }),
);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const result = await loaded;
  if ("error" in result) {
    const e = result.error;
    console.error("[startup] server failed to start", e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Server failed to start:\n\n${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return;
  }
  result.app(req, res);
}
