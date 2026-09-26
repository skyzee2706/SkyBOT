import { useState, type ReactNode } from "react";

// Menampilkan teks berformat Discord (deskripsi raffle) di web, sama seperti di Discord:
// # / ## / ### judul, -# teks kecil, > kutipan, - daftar, ``` blok kode ```,
// **tebal**, *miring*, __garis bawah__, ~~coret~~, ||spoiler||, `kode`, [link](https://...), link biasa,
// dan token Discord (<t:...> waktu, <:emoji:id>, mention).
// Semua dirender sebagai elemen React (bukan HTML mentah), jadi aman dari injeksi script.

type InlineRule = { re: RegExp; render: (m: RegExpExecArray, key: string) => ReactNode };

const TIME_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: "short" },
  T: { timeStyle: "medium" },
  d: { dateStyle: "short" },
  D: { dateStyle: "long" },
  f: { dateStyle: "long", timeStyle: "short" },
  F: { dateStyle: "full", timeStyle: "short" },
};

function relative(date: Date) {
  const diff = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, secs] = units.find(([, s]) => Math.abs(diff) >= s) ?? ["second", 1];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(diff / secs), unit);
}

const chip = "rounded bg-brand-500/15 px-1 text-brand-200";

// Urutan penting: yang lebih "kuat" (kode, link) dicek lebih dulu
const RULES: InlineRule[] = [
  { re: /`([^`\n]+)`/, render: (m, k) => <code key={k} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em]">{m[1]}</code> },
  {
    re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/,
    render: (m, k) => (
      <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-300 hover:underline">
        {inline(m[1], k)}
      </a>
    ),
  },
  {
    re: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/,
    render: (m, k) => {
      const date = new Date(Number(m[1]) * 1000);
      const style = m[2] ?? "f";
      const text = style === "R" ? relative(date) : date.toLocaleString("en-US", TIME_STYLES[style]);
      return (
        <time key={k} dateTime={date.toISOString()} className="rounded bg-zinc-800 px-1">
          {text}
        </time>
      );
    },
  },
  {
    re: /<(a?):(\w{2,32}):(\d{17,20})>/,
    render: (m, k) => (
      <img
        key={k}
        src={`https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? "gif" : "webp"}?size=48`}
        alt={`:${m[2]}:`}
        title={`:${m[2]}:`}
        className="inline-block h-[1.3em] w-[1.3em] align-text-bottom"
      />
    ),
  },
  { re: /<@&\d{17,20}>/, render: (_m, k) => <span key={k} className={chip}>@role</span> },
  { re: /<@!?\d{17,20}>/, render: (_m, k) => <span key={k} className={chip}>@user</span> },
  { re: /<#\d{17,20}>/, render: (_m, k) => <span key={k} className={chip}>#channel</span> },
  { re: /\*\*([\s\S]+?)\*\*/, render: (m, k) => <strong key={k} className="font-semibold text-brand-50">{inline(m[1], k)}</strong> },
  { re: /__([\s\S]+?)__/, render: (m, k) => <u key={k}>{inline(m[1], k)}</u> },
  { re: /~~([\s\S]+?)~~/, render: (m, k) => <s key={k}>{inline(m[1], k)}</s> },
  { re: /\|\|([\s\S]+?)\|\|/, render: (m, k) => <Spoiler key={k}>{inline(m[1], k)}</Spoiler> },
  { re: /\*(?!\s)([^*\n]+?)\*/, render: (m, k) => <em key={k}>{inline(m[1], k)}</em> },
  { re: /(?<![\w])_(?!\s)([^_\n]+?)_(?![\w])/, render: (m, k) => <em key={k}>{inline(m[1], k)}</em> },
  {
    re: /https?:\/\/[^\s<>]+[^\s<>.,:;"')\]]/,
    render: (m, k) => (
      <a key={k} href={m[0]} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-300 hover:underline">
        {m[0]}
      </a>
    ),
  },
];

// Format dalam satu baris: cari pola yang paling awal muncul, render, lalu lanjut ke sisa teks
function inline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { m: RegExpExecArray; rule: InlineRule } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyPrefix}.${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setShown(true)}
      onKeyDown={(e) => e.key === "Enter" && setShown(true)}
      className={`rounded px-0.5 transition ${shown ? "bg-zinc-800" : "cursor-pointer bg-zinc-700 text-transparent select-none"}`}
    >
      {children}
    </span>
  );
}

type Block =
  | { type: "code"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "subtext"; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "text"; lines: string[] };

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ``` blok kode ```
    if (line.trimStart().startsWith("```")) {
      const first = line.trimStart().slice(3);
      const oneLine = first.indexOf("```");
      if (oneLine >= 0) {
        blocks.push({ type: "code", text: first.slice(0, oneLine) });
        continue;
      }
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].includes("```")) body.push(lines[j++]);
      if (j < lines.length) {
        const lastLine = lines[j].slice(0, lines[j].indexOf("```"));
        if (lastLine) body.push(lastLine);
        blocks.push({ type: "code", text: body.join("\n") });
        i = j;
        continue;
      }
      // tanpa penutup: anggap teks biasa
    }
    const heading = /^(#{1,3}) +(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    const sub = /^-# +(.+)$/.exec(line);
    if (sub) {
      blocks.push({ type: "subtext", text: sub[1] });
      continue;
    }
    const quote = /^> ?(.*)$/.exec(line);
    if (quote) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === "quote") prev.lines.push(quote[1]);
      else blocks.push({ type: "quote", lines: [quote[1]] });
      continue;
    }
    const item = /^\s*[-*•] +(.+)$/.exec(line);
    if (item) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === "list") prev.items.push(item[1]);
      else blocks.push({ type: "list", items: [item[1]] });
      continue;
    }
    const prev = blocks[blocks.length - 1];
    if (prev?.type === "text") prev.lines.push(line);
    else blocks.push({ type: "text", lines: [line] });
  }
  return blocks;
}

const HEADING_CLS = { 1: "text-2xl", 2: "text-xl", 3: "text-lg" } as const;

export function DiscordMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`space-y-2 break-words text-sm leading-relaxed text-zinc-300 ${className}`}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200">
                {b.text}
              </pre>
            );
          case "heading": {
            const Tag = (`h${b.level + 2}` as "h3" | "h4" | "h5");
            return (
              <Tag key={key} className={`${HEADING_CLS[b.level]} pt-1 font-bold text-brand-100`}>
                {inline(b.text, key)}
              </Tag>
            );
          }
          case "subtext":
            return (
              <p key={key} className="text-xs text-zinc-500">
                {inline(b.text, key)}
              </p>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-4 border-zinc-600 pl-3 text-zinc-300">
                {b.lines.map((l, j) => (
                  <div key={j} className="min-h-[1.25em]">
                    {inline(l, `${key}.${j}`)}
                  </div>
                ))}
              </blockquote>
            );
          case "list":
            return (
              <ul key={key} className="list-disc space-y-1 pl-5 marker:text-brand-400">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${key}.${j}`)}</li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={key} className="whitespace-pre-wrap">
                {b.lines.map((l, j) => (
                  <span key={j}>
                    {j > 0 && "\n"}
                    {inline(l, `${key}.${j}`)}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
