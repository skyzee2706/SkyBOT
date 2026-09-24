import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./api/auth.js";
import { cronRouter } from "./api/cron.js";
import { dashboardRouter, HttpError } from "./api/dashboard.js";
import { interactionsRouter } from "./api/interactions.js";
import { xRouter } from "./api/xauth.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Route ini butuh body mentah untuk verifikasi tanda tangan, jadi dipasang sebelum parser JSON.
app.use("/api/interactions", interactionsRouter);
app.use("/api/cron", cronRouter);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/x", xRouter);
app.use("/api", dashboardRouter);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err?.status === 401) {
    res.status(401).json({ error: "Sesi Discord kamu sudah habis, silakan login ulang." });
    return;
  }
  console.error("[api] error", err);
  res.status(500).json({ error: "Terjadi error di server." });
};
app.use(onError);

export default app;
