import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { Raffle } from "@prisma/client";
import { ALLOCATIONS, allocationCount, chainLabel, hasAllocations, publicRafflePath, walletName } from "../../shared/raffle.js";
import { env } from "../env.js";
import { taskClickUrl, tweetUrl } from "../x.js";
import { getXPosts, hasXTasks, quotePosts, xTaskList } from "./xtasks.js";

export { hasXTasks };

const ts = (d: Date, style = "R") => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

function xTaskLines(r: Raffle) {
  const lines = r.xFollowUsernames.map((u) => `Follow [@${u}](https://x.com/${u}) on X`);
  const posts = getXPosts(r);
  posts.forEach((p, i) => {
    const acts = [p.like && "Like", p.retweet && "Retweet", p.quote && "Quote"].filter(Boolean).join(" + ");
    const name = posts.length > 1 ? `post #${i + 1}` : "this post";
    if (acts) lines.push(`${acts} [${name}](${tweetUrl(p.tweetId)})`);
  });
  return lines;
}

// Daftar mention maks 1024 karakter per field embed; sisanya diringkas jadi "+N more".
function fitMentions(ids: string[]) {
  let out = "";
  for (const [i, id] of ids.entries()) {
    const next = (out ? ", " : "") + `<@${id}>`;
    const rest = ids.length - i;
    if (out.length + next.length > 1024 - 12) return `${out} +${rest} more`;
    out += next;
  }
  return out;
}

export function raffleEmbed(raffle: Raffle, entryCount: number, winners: { userId: string; allocation: string | null }[] = []) {
  const ended = raffle.status !== "ACTIVE";
  const reqs: string[] = [];
  if (raffle.requiredRoleIds.length) {
    const roles = raffle.requiredRoleIds.map((id) => `<@&${id}>`).join(raffle.requireAnyRole ? " or " : ", ");
    reqs.push(`${raffle.requireAnyRole && raffle.requiredRoleIds.length > 1 ? "Have one of these roles" : "Required role"}: ${roles}`);
  }
  if (raffle.blockedRoleIds.length) reqs.push(`Blocked role: ${raffle.blockedRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
  if (!raffle.requireMember) reqs.push("🌐 Open to non-members (enter on the web page)");
  if (raffle.minAccountAgeDays) reqs.push(`Discord account age ≥ ${raffle.minAccountAgeDays} days`);
  if (hasXTasks(raffle)) reqs.push("Connect your X account", ...xTaskLines(raffle));
  if (raffle.walletType !== "NONE") reqs.push(`Submit ${walletName(raffle)} wallet`); // selalu paling bawah

  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${raffle.title}`.slice(0, 256))
    .setURL(`${env.PUBLIC_URL}${publicRafflePath(raffle.id)}`) // judul biru → halaman raffle di web
    .setColor(raffle.status === "CANCELLED" ? 0x6b7280 : ended ? 0x22c55e : 0xf2963a) // oranye = warna brand SkyBOT
    .setFooter({ text: `Raffle ID: ${raffle.id}` });

  if (raffle.description) embed.setDescription(raffle.description.slice(0, 4000));
  if (raffle.imageUrl) embed.setImage(raffle.imageUrl);
  if (raffle.hostName) {
    embed.setAuthor({ name: `Hosted by ${raffle.hostName}`.slice(0, 256), iconURL: raffle.hostAvatar ?? undefined });
  }
  const chain = chainLabel(raffle.chain);
  const allocations = hasAllocations(raffle)
    ? ALLOCATIONS.filter((a) => allocationCount(raffle, a) > 0)
        .map((a) => `${a} ${allocationCount(raffle, a)}`)
        .join("\n")
    : null;

  embed.addFields(
    allocations
      ? { name: "Allocations", value: allocations, inline: true }
      : { name: "Winners", value: String(raffle.winnerCount), inline: true },
    ...(chain ? [{ name: "Chain", value: chain, inline: true }] : []),
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
    if (hasAllocations(raffle)) {
      for (const a of ALLOCATIONS.filter((a) => allocationCount(raffle, a) > 0)) {
        const ids = winners.filter((w) => w.allocation === a).map((w) => w.userId);
        embed.addFields({ name: `🏆 ${a} Winners`, value: ids.length ? fitMentions(ids) : "No eligible entrants" });
      }
    } else {
      const ids = winners.map((w) => w.userId);
      embed.addFields({ name: "🏆 Winners", value: ids.length ? fitMentions(ids) : "No eligible entrants" });
    }
  }
  // Batas total embed Discord 6000 karakter: kalau lewat, deskripsi yang dipotong.
  const d = embed.data;
  const size =
    (d.title?.length ?? 0) + (d.author?.name.length ?? 0) + (d.footer?.text.length ?? 0) +
    (d.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  if (d.description && size + d.description.length > 5900) embed.setDescription(d.description.slice(0, Math.max(0, 5900 - size - 1)) + "…");
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
// Task yang belum dibuka = tombol link abu-abu; yang sudah = tombol hijau ✅ (nonaktif).
// "Done, enter me" baru bisa diklik setelah semua task dibuka.
export function xTaskComponents(raffle: Raffle, userId: string, done: ReadonlySet<string>) {
  const list = xTaskList(raffle);
  const tasks = list.map((t) =>
    done.has(t.key)
      ? new ButtonBuilder()
          .setCustomId(`raffle:done:${raffle.id}:${t.key}`)
          .setLabel(`✅ ${t.label.replace(/^(❤️|🔁|💬) /u, "")}`.slice(0, 80))
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      : link(t.label.slice(0, 80), taskClickUrl({ raffleId: raffle.id, userId, task: t.key })),
  );
  const allDone = list.every((t) => done.has(t.key));

  // Maks 4 baris tombol task (20 tombol) + 1 baris konfirmasi = batas 5 baris Discord
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < tasks.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(tasks.slice(i, i + 5)));
  }
  const quoteCount = quotePosts(raffle).length;
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        // Q<n> = form perlu n link quote
        .setCustomId(`raffle:confirm:${raffle.id}:${raffle.walletType}:${quoteCount ? `Q${quoteCount}` : "-"}`)
        .setLabel(allDone ? "✅ Done, enter me" : "🔒 Done, enter me")
        .setStyle(allDone ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(!allDone),
    ),
  );
  return rows.map((r) => r.toJSON());
}

export const connectXComponents = (url: string, label = "Connect X account") => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(link(label, url)).toJSON(),
];
