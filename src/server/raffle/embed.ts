import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { Raffle } from "@prisma/client";
import { intentFollow, intentLike, intentQuote, intentRetweet, tweetUrl } from "../x.js";

const ts = (d: Date, style = "R") => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

type XTasks = Pick<Raffle, "xFollowUsernames" | "xTweetId" | "xLike" | "xRetweet" | "xQuote">;

export const hasXTasks = (r: XTasks) =>
  r.xFollowUsernames.length > 0 || (!!r.xTweetId && (r.xLike || r.xRetweet || r.xQuote));

function xTaskLines(r: XTasks) {
  const lines = r.xFollowUsernames.map((u) => `Follow [@${u}](https://x.com/${u}) on X`);
  if (r.xTweetId) {
    const acts = [r.xLike && "Like", r.xRetweet && "Retweet", r.xQuote && "Quote"].filter(Boolean).join(" + ");
    if (acts) lines.push(`${acts} [this post](${tweetUrl(r.xTweetId)})`);
  }
  return lines;
}

export function raffleEmbed(raffle: Raffle, entryCount: number, winnerIds: string[] = []) {
  const ended = raffle.status !== "ACTIVE";
  const reqs: string[] = [];
  if (raffle.requiredRoleIds.length) reqs.push(`Required role: ${raffle.requiredRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
  if (raffle.blockedRoleIds.length) reqs.push(`Blocked role: ${raffle.blockedRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
  if (raffle.minAccountAgeDays) reqs.push(`Discord account age ≥ ${raffle.minAccountAgeDays} days`);
  if (raffle.walletType !== "NONE") reqs.push(`Submit ${raffle.walletType === "EVM" ? "EVM (0x...)" : "Solana"} wallet`);
  if (hasXTasks(raffle)) reqs.push("Connect your X account", ...xTaskLines(raffle));

  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${raffle.title}`)
    .setColor(raffle.status === "CANCELLED" ? 0x6b7280 : ended ? 0x22c55e : 0x6366f1)
    .setFooter({ text: `Raffle ID: ${raffle.id}` });

  if (raffle.description) embed.setDescription(raffle.description.slice(0, 4000));
  if (raffle.imageUrl) embed.setImage(raffle.imageUrl);

  embed.addFields(
    { name: "Winners", value: String(raffle.winnerCount), inline: true },
    { name: "Entries", value: String(entryCount), inline: true },
    {
      name: ended ? "Ended" : "Ends",
      value: ended ? ts(raffle.endedAt ?? raffle.endsAt, "f") : `${ts(raffle.endsAt)} (${ts(raffle.endsAt, "f")})`,
      inline: true,
    },
    {
      name: "Requirements",
      value: (reqs.length ? reqs.map((r) => `• ${r}`).join("\n") : "None — anyone can join").slice(0, 1024),
    },
  );

  if (raffle.status === "CANCELLED") embed.addFields({ name: "Status", value: "❌ This raffle was cancelled" });
  else if (ended) {
    const list = winnerIds.map((id) => `<@${id}>`).join(", ");
    embed.addFields({ name: "🏆 Winners", value: (list || "No eligible entrants").slice(0, 1024) });
  }
  return embed;
}

export function raffleButtons(raffle: Raffle) {
  const active = raffle.status === "ACTIVE";
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      // Jenis wallet & ada/tidaknya task X ikut di customId supaya respons pertama bisa dikirim tanpa query database
      .setCustomId(`raffle:enter:${raffle.id}:${raffle.walletType}:${hasXTasks(raffle) ? "X" : "-"}`)
      .setLabel(active ? "Enter" : "Ended")
      .setEmoji("🎟️")
      .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!active),
    new ButtonBuilder().setCustomId(`raffle:status:${raffle.id}`).setLabel("My status").setStyle(ButtonStyle.Secondary),
  );
  if (active && hasXTasks(raffle)) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`raffle:connectx:${raffle.id}`).setLabel("Connect X").setEmoji("🔗").setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

const link = (label: string, url: string) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);

// Tombol task X (maks 5 per baris) + tombol konfirmasi.
export function xTaskComponents(raffle: Raffle) {
  const tasks = raffle.xFollowUsernames.map((u) => link(`Follow @${u}`.slice(0, 80), intentFollow(u)));
  if (raffle.xTweetId && raffle.xLike) tasks.push(link("❤️ Like", intentLike(raffle.xTweetId)));
  if (raffle.xTweetId && raffle.xRetweet) tasks.push(link("🔁 Retweet", intentRetweet(raffle.xTweetId)));
  if (raffle.xTweetId && raffle.xQuote) tasks.push(link("💬 Quote", intentQuote(raffle.xTweetId)));

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < tasks.length; i += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(tasks.slice(i, i + 5)));
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        // Flag Q = perlu form link quote
        .setCustomId(`raffle:confirm:${raffle.id}:${raffle.walletType}:${raffle.xQuote && raffle.xTweetId ? "Q" : "-"}`)
        .setLabel("✅ Done, enter me")
        .setStyle(ButtonStyle.Success),
    ),
  );
  return rows.map((r) => r.toJSON());
}

export const connectXComponents = (url: string, label = "Connect X account") => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(link(label, url)).toJSON(),
];
