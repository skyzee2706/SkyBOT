import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { Raffle } from "@prisma/client";
import { intentFollow, intentLike, intentRetweet, tweetUrl } from "../x.js";

const ts = (d: Date, style = "R") => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

type XTasks = Pick<Raffle, "xFollowUsernames" | "xTweetId" | "xLike" | "xRetweet">;

export const hasXTasks = (r: XTasks) => r.xFollowUsernames.length > 0 || (!!r.xTweetId && (r.xLike || r.xRetweet));

function xTaskLines(r: XTasks) {
  const lines = r.xFollowUsernames.map((u) => `Follow [@${u}](https://x.com/${u}) di X`);
  if (r.xTweetId) {
    const acts = [r.xLike && "Like", r.xRetweet && "Retweet"].filter(Boolean).join(" + ");
    if (acts) lines.push(`${acts} [post ini](${tweetUrl(r.xTweetId)})`);
  }
  return lines;
}

export function raffleEmbed(raffle: Raffle, entryCount: number, winnerIds: string[] = []) {
  const ended = raffle.status !== "ACTIVE";
  const reqs: string[] = [];
  if (raffle.requiredRoleIds.length) reqs.push(`Role wajib: ${raffle.requiredRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
  if (raffle.blockedRoleIds.length) reqs.push(`Role dilarang: ${raffle.blockedRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
  if (raffle.minAccountAgeDays) reqs.push(`Umur akun Discord ≥ ${raffle.minAccountAgeDays} hari`);
  if (raffle.walletType !== "NONE") reqs.push(`Submit wallet ${raffle.walletType === "EVM" ? "EVM (0x...)" : "Solana"}`);
  if (hasXTasks(raffle)) reqs.push("Hubungkan akun X", ...xTaskLines(raffle));

  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${raffle.title}`)
    .setColor(raffle.status === "CANCELLED" ? 0x6b7280 : ended ? 0x22c55e : 0x6366f1)
    .setFooter({ text: `Raffle ID: ${raffle.id}` });

  if (raffle.description) embed.setDescription(raffle.description.slice(0, 4000));
  if (raffle.imageUrl) embed.setImage(raffle.imageUrl);

  embed.addFields(
    { name: "Pemenang", value: String(raffle.winnerCount), inline: true },
    { name: "Peserta", value: String(entryCount), inline: true },
    {
      name: ended ? "Berakhir" : "Berakhir dalam",
      value: ended ? ts(raffle.endedAt ?? raffle.endsAt, "f") : `${ts(raffle.endsAt)} (${ts(raffle.endsAt, "f")})`,
      inline: true,
    },
    {
      name: "Syarat",
      value: (reqs.length ? reqs.map((r) => `• ${r}`).join("\n") : "Tidak ada — siapa saja boleh ikut").slice(0, 1024),
    },
  );

  if (raffle.status === "CANCELLED") embed.addFields({ name: "Status", value: "❌ Raffle dibatalkan" });
  else if (ended) {
    const list = winnerIds.map((id) => `<@${id}>`).join(", ");
    embed.addFields({ name: "🏆 Pemenang", value: (list || "Tidak ada peserta yang memenuhi syarat").slice(0, 1024) });
  }
  return embed;
}

export function raffleButtons(raffle: Raffle) {
  const active = raffle.status === "ACTIVE";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      // Jenis wallet & ada/tidaknya task X ikut di customId supaya respons pertama bisa dikirim tanpa query database
      .setCustomId(`raffle:enter:${raffle.id}:${raffle.walletType}:${hasXTasks(raffle) ? "X" : "-"}`)
      .setLabel(active ? "Enter" : "Selesai")
      .setEmoji("🎟️")
      .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!active),
    new ButtonBuilder()
      .setCustomId(`raffle:status:${raffle.id}`)
      .setLabel("Cek status saya")
      .setStyle(ButtonStyle.Secondary),
  );
}

const link = (label: string, url: string) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);

// Tombol task X (maks 5 per baris) + tombol konfirmasi.
export function xTaskComponents(raffle: Raffle) {
  const tasks = raffle.xFollowUsernames.map((u) => link(`Follow @${u}`.slice(0, 80), intentFollow(u)));
  if (raffle.xTweetId && raffle.xLike) tasks.push(link("❤️ Like", intentLike(raffle.xTweetId)));
  if (raffle.xTweetId && raffle.xRetweet) tasks.push(link("🔁 Retweet", intentRetweet(raffle.xTweetId)));

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < tasks.length; i += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(tasks.slice(i, i + 5)));
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`raffle:confirm:${raffle.id}:${raffle.walletType}`)
        .setLabel("✅ Sudah semua, masukkan saya")
        .setStyle(ButtonStyle.Success),
    ),
  );
  return rows.map((r) => r.toJSON());
}

export const connectXComponents = (url: string) => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(link("Hubungkan akun X", url)).toJSON(),
];
