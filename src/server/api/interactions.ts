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
import { connectXReply, enterRaffle, entryStatus, startXTasks, type Entrant, type Reply } from "../raffle/service.js";
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
    reply = "⚠️ Something went wrong, please try again in a moment.";
  }
  const body = typeof reply === "string" ? { content: reply, components: [] } : { components: [], ...reply };
  await rest
    .patch(Routes.webhookMessage(i.application_id, i.token), { body, auth: false })
    .catch((e) => console.error("[interaction] failed to reply", e));
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

const textInput = (customId: string, label: string, placeholder: string, min: number, max: number) => ({
  type: ComponentType.ActionRow,
  components: [
    {
      type: ComponentType.TextInput,
      custom_id: customId,
      label,
      placeholder,
      style: TextInputStyle.Short,
      min_length: min,
      max_length: max,
      required: true,
    },
  ],
});

// Form yang muncul di Discord: link quote dan/atau wallet.
// Discord membatasi 5 input per form; dashboard memastikan jumlah quote + wallet ≤ 5.
function entryModal(raffleId: string, walletType: string, quoteCount: number) {
  const components = [];
  for (let n = 1; n <= quoteCount; n++) {
    const label = quoteCount > 1 ? `Link to your quote of post #${n}` : "Link to your quote post";
    components.push(textInput(`quote${n}`, label, "https://x.com/yourname/status/...", 20, 200));
  }
  if (walletType !== "NONE") {
    components.push(
      walletType === "EVM"
        ? textInput("wallet", "EVM wallet address", "0x...", 42, 42)
        : textInput("wallet", "Solana wallet address", "Your Solana address", 32, 44),
    );
  }
  return {
    type: InteractionResponseType.Modal,
    data: { custom_id: `raffle:submit:${raffleId}`, title: "Enter Raffle", components },
  };
}

const ephemeral = (content: string) => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

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
    res.json(ephemeral("Unknown action."));
    return;
  }
  const gi = i as GuildInteraction;
  const [, action, raffleId, walletType = "NONE", flag] = gi.data.custom_id.split(":");
  const isButton = i.type === InteractionType.MessageComponent;
  const needsWallet = walletType !== "NONE";
  // "Q3" = 3 link quote; "Q" (tombol versi lama) = 1
  const quoteCount = flag?.startsWith("Q") ? Math.min(5, Number(flag.slice(1)) || 1) : 0;

  // Form (modal) harus jadi respons pertama (maks 3 detik), jadi dikirim langsung tanpa query database.
  // Enter tanpa task X → langsung form wallet. Dengan task X → form muncul setelah "Done, enter me".
  if (isButton && action === "enter" && flag !== "X" && needsWallet) {
    res.json(entryModal(raffleId, walletType, 0));
    return;
  }
  if (isButton && action === "confirm" && (needsWallet || quoteCount)) {
    res.json(entryModal(raffleId, walletType, quoteCount));
    return;
  }

  let work: (() => Promise<Reply>) | null = null;
  let updateSameMessage = false;
  if (isButton && action === "enter") {
    work = flag === "X" ? () => startXTasks(raffleId, entrantOf(gi)) : () => enterRaffle(raffleId, entrantOf(gi));
  } else if (isButton && action === "confirm") {
    // Tombol ada di pesan daftar task (ephemeral) — hasilnya menggantikan pesan itu.
    updateSameMessage = true;
    work = () => enterRaffle(raffleId, entrantOf(gi));
  } else if (isButton && action === "status") {
    work = () => entryStatus(raffleId, gi.member.user.id);
  } else if (isButton && action === "connectx") {
    work = () => connectXReply(gi.member.user.id);
  } else if (i.type === InteractionType.ModalSubmit && (action === "submit" || action === "wallet")) {
    const fields = (gi as APIModalSubmitInteraction).data.components;
    const wallet = findInputValue(fields, "wallet");
    const quoteUrls = [1, 2, 3, 4, 5].map((n) => findInputValue(fields, `quote${n}`));
    quoteUrls[0] ??= findInputValue(fields, "quote"); // form versi lama
    work = () => enterRaffle(raffleId, entrantOf(gi), { wallet, quoteUrls });
  }

  if (!work) {
    res.json(ephemeral("Unknown action."));
    return;
  }

  // Balas "sedang diproses" dulu (Discord cuma kasih 3 detik), lalu kerjakan di belakang layar.
  res.json(
    updateSameMessage
      ? { type: InteractionResponseType.DeferredMessageUpdate }
      : { type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } },
  );
  waitUntil(finish(i, work));
});
