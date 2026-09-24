import { createPublicKey, verify } from "node:crypto";
import { Router } from "express";
import { waitUntil } from "@vercel/functions";
import {
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  Routes,
  TextInputStyle,
  type APIInteraction,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
} from "discord.js";
import { rest } from "../discord.js";
import { env } from "../env.js";
import { enterRaffle, entryStatus, startXTasks, type Entrant, type Reply } from "../raffle/service.js";
import { readRawBody } from "./rawBody.js";

const publicKey = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(env.DISCORD_PUBLIC_KEY, "hex")]),
  format: "der",
  type: "spki",
});

function isValidSignature(signature: string | undefined, timestamp: string | undefined, body: string) {
  if (!signature || !timestamp) return false;
  try {
    return verify(null, Buffer.from(timestamp + body), publicKey, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

type GuildInteraction = (APIMessageComponentInteraction | APIModalSubmitInteraction) & {
  member: NonNullable<APIMessageComponentInteraction["member"]>;
};

const entrantOf = (i: GuildInteraction): Entrant => ({
  userId: i.member.user.id,
  username: i.member.user.username,
  roleIds: i.member.roles,
});

// Kirim hasil ke pesan "sedang diproses..." yang tadi di-defer.
async function finish(i: APIInteraction, work: () => Promise<Reply>) {
  let reply: Reply;
  try {
    reply = await work();
  } catch (e) {
    console.error("[interaction] error", e);
    reply = "⚠️ Terjadi error, coba lagi sebentar.";
  }
  const body = typeof reply === "string" ? { content: reply, components: [] } : { components: [], ...reply };
  await rest
    .patch(Routes.webhookMessage(i.application_id, i.token), { body, auth: false })
    .catch((e) => console.error("[interaction] gagal membalas", e));
}

function findInputValue(components: unknown, customId: string): string | undefined {
  if (!Array.isArray(components)) return undefined;
  for (const c of components as { custom_id?: string; value?: string; components?: unknown; component?: unknown }[]) {
    if (c.custom_id === customId && typeof c.value === "string") return c.value;
    const nested = findInputValue(c.components, customId) ?? findInputValue(c.component ? [c.component] : [], customId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

const deferredEphemeral = {
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MessageFlags.Ephemeral },
};

export const interactionsRouter = Router();

interactionsRouter.post("/", async (req, res) => {
  const body = await readRawBody(req);
  if (!isValidSignature(req.header("x-signature-ed25519"), req.header("x-signature-timestamp"), body)) {
    res.status(401).send("invalid request signature");
    return;
  }
  const i = JSON.parse(body) as APIInteraction;

  if (i.type === InteractionType.Ping) {
    res.json({ type: InteractionResponseType.Pong });
    return;
  }

  if (!i.member || !("data" in i) || !i.data || !("custom_id" in i.data) || !i.data.custom_id.startsWith("raffle:")) {
    res.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: "Tidak dikenal.", flags: MessageFlags.Ephemeral } });
    return;
  }
  const gi = i as GuildInteraction;
  const [, action, raffleId, walletType, xFlag] = gi.data.custom_id.split(":");
  const isButton = i.type === InteractionType.MessageComponent;
  const needsWallet = !!walletType && walletType !== "NONE";

  // Raffle dengan task X: tampilkan task dulu. Tanpa task X: langsung form wallet (kalau perlu).
  // Tombol "confirm" ada di bawah daftar task, setelah itu baru form wallet.
  if (isButton && needsWallet && ((action === "enter" && xFlag !== "X") || action === "confirm")) {
    // Form wallet harus jadi respons pertama (maks 3 detik), jadi langsung dikirim tanpa query database.
    res.json({
      type: InteractionResponseType.Modal,
      data: {
        custom_id: `raffle:wallet:${raffleId}`,
        title: "Masuk Raffle",
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: "wallet",
                label: walletType === "EVM" ? "Alamat wallet EVM (0x...)" : "Alamat wallet Solana",
                style: TextInputStyle.Short,
                min_length: 32,
                max_length: 44,
                required: true,
              },
            ],
          },
        ],
      },
    });
    return;
  }

  let work: (() => Promise<Reply>) | null = null;
  let updateSameMessage = false;
  if (isButton && action === "enter") {
    work = xFlag === "X" ? () => startXTasks(raffleId, entrantOf(gi)) : () => enterRaffle(raffleId, entrantOf(gi));
  } else if (isButton && action === "confirm") {
    // Tombol ada di pesan daftar task (ephemeral) — hasilnya menggantikan pesan itu.
    updateSameMessage = true;
    work = () => enterRaffle(raffleId, entrantOf(gi));
  } else if (isButton && action === "status") {
    work = () => entryStatus(raffleId, gi.member.user.id);
  } else if (i.type === InteractionType.ModalSubmit && action === "wallet") {
    const wallet = findInputValue((gi as APIModalSubmitInteraction).data.components, "wallet") ?? "";
    work = () => enterRaffle(raffleId, entrantOf(gi), wallet);
  }

  if (!work) {
    res.json({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: "Aksi tidak dikenal.", flags: MessageFlags.Ephemeral } });
    return;
  }

  // Balas "sedang diproses" dulu (Discord cuma kasih 3 detik), lalu kerjakan di belakang layar.
  res.json(updateSameMessage ? { type: InteractionResponseType.DeferredMessageUpdate } : deferredEphemeral);
  waitUntil(finish(i, work));
});
