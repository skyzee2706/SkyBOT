// Harus di-import PALING PERTAMA di setiap file tes: mengisi env sebelum kode server dimuat.
import { generateKeyPairSync } from "node:crypto";

export const discordKeys = generateKeyPairSync("ed25519");
const rawPublicKey = discordKeys.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");

Object.assign(process.env, {
  DISCORD_CLIENT_ID: "123456789012345678",
  DISCORD_CLIENT_SECRET: "test-secret",
  DISCORD_BOT_TOKEN: "test-token",
  DISCORD_PUBLIC_KEY: rawPublicKey,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5433/skybot_test",
  PUBLIC_URL: "https://skybot.test",
  X_API_KEY: "k",
  X_API_SECRET: "s",
  ADMIN_DISCORD_IDS: "900000000000000001",
  ALERT_WEBHOOK_URL: "",
});
