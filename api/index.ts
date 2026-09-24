// Entry point Vercel Function — semua request /api/* diarahkan ke sini (lihat vercel.json).
import type { IncomingMessage, ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// Dimuat secara dinamis supaya kalau server gagal start (mis. env belum diisi),
// pesan error-nya tampil di browser, bukan hanya "FUNCTION_INVOCATION_FAILED".
const appPromise = import("../src/server/app.js").then((m) => m.default as unknown as Handler);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  let app: Handler;
  try {
    app = await appPromise;
  } catch (e) {
    console.error("[startup] server gagal start", e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Server gagal start:\n\n${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  app(req, res);
}
