import type { Request } from "express";

// Verifikasi tanda tangan (Discord & QStash) butuh body mentah persis seperti yang dikirim.
// Di Vercel wajib set NODEJS_HELPERS=0 supaya body tidak di-parse duluan.
export async function readRawBody(req: Request): Promise<string> {
  if (req.readable && !req.readableEnded) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  return "";
}
