import { readFile } from "node:fs/promises";
import { ImageResponse } from "@vercel/og";
import type { Raffle } from "@prisma/client";
import { ALLOCATIONS, allocationCount, allocationSummary, chainLabel, hasAllocations } from "../shared/raffle.js";

// Kartu preview link per raffle (1200×630): tema SkyBOT, nama raffle, allocation, chain & status.
// Digambar di server (satori + resvg lewat @vercel/og), tanpa React — elemen ditulis sebagai objek biasa.

type Style = Record<string, string | number>;
type Node = { type: string; props: { style?: Style; src?: string; width?: number; height?: number; children?: unknown } };
const el = (type: string, style: Style, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

const asset = (name: string) => readFile(new URL(`./assets/${name}`, import.meta.url));
let assets: Promise<{ fonts: { name: string; data: Buffer; weight: 400 | 600 | 800 }[]; logo: string }> | null = null;
const loadAssets = () =>
  (assets ??= Promise.all([
    asset("inter-latin-400-normal.woff"),
    asset("inter-latin-600-normal.woff"),
    asset("inter-latin-800-normal.woff"),
    asset("logo.png"),
  ]).then(([r, s, b, logo]) => ({
    fonts: [
      { name: "Inter", data: r, weight: 400 as const },
      { name: "Inter", data: s, weight: 600 as const },
      { name: "Inter", data: b, weight: 800 as const },
    ],
    logo: `data:image/png;base64,${logo.toString("base64")}`,
  })));

const C = {
  bg: "#100e0c",
  card: "#1a1714",
  border: "#2e2923",
  text: "#fdf6ee",
  muted: "#a8a29e",
  brand: "#f2963a",
  brandSoft: "rgba(242,150,58,0.14)",
  brandBorder: "rgba(242,150,58,0.45)",
  green: "#34d399",
  red: "#f87171",
};

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const pill = (text: string, accent: boolean) =>
  el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      padding: "12px 24px",
      borderRadius: 999,
      fontSize: 30,
      fontWeight: 600,
      color: accent ? C.brand : C.text,
      background: accent ? C.brandSoft : C.card,
      border: `2px solid ${accent ? C.brandBorder : C.border}`,
    },
    text,
  );

export type OgRaffle = Pick<
  Raffle,
  "title" | "guildName" | "status" | "endsAt" | "endedAt" | "chain" | "gtdCount" | "fcfsCount" | "winnerCount"
>;

export async function raffleOgImage(r: OgRaffle): Promise<Buffer> {
  const { fonts, logo } = await loadAssets();
  const allocations = hasAllocations(r)
    ? ALLOCATIONS.filter((a) => allocationCount(r, a) > 0).map((a) => `${a} ${allocationCount(r, a)}`)
    : [allocationSummary(r)];
  const chain = chainLabel(r.chain);
  const live = r.status === "ACTIVE";
  const status = live ? `Ends ${DATE.format(r.endsAt)}` : `Ended ${DATE.format(r.endedAt ?? r.endsAt)}`;
  const title = r.title.length > 56 ? `${r.title.slice(0, 54).trimEnd()}…` : r.title; // maks 2 baris

  const root = el(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "64px 72px",
      backgroundColor: C.bg,
      backgroundImage: "radial-gradient(circle at 88% 8%, rgba(242,150,58,0.30), rgba(242,150,58,0) 45%)",
      fontFamily: "Inter",
      color: C.text,
    },
    [
      // Atas: logo + nama aplikasi, status di kanan
      el("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        el("div", { display: "flex", alignItems: "center", gap: 18 }, [
          el("img", { width: 64, height: 64, borderRadius: 16 }, undefined, { src: logo, width: 64, height: 64 }),
          el("div", { display: "flex", fontSize: 34, fontWeight: 800 }, [
            el("span", { color: C.text }, "SkyBOT"),
            el("span", { color: C.brand, marginLeft: 10 }, "Raffle"),
          ]),
        ]),
        el(
          "div",
          {
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 26,
            fontWeight: 600,
            color: live ? C.green : C.red,
          },
          [el("div", { width: 14, height: 14, borderRadius: 999, background: live ? C.green : C.red }), live ? "Live" : "Ended"],
        ),
      ]),
      // Tengah: nama raffle & komunitas
      el("div", { display: "flex", flexDirection: "column", gap: 18 }, [
        el("div", { display: "flex", fontSize: title.length > 40 ? 64 : 76, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5 }, title),
        r.guildName ? el("div", { display: "flex", fontSize: 32, color: C.muted }, `by ${r.guildName}`) : el("div", { display: "flex" }),
      ]),
      // Bawah: allocation + chain, tanggal di kanan
      el("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        el("div", { display: "flex", gap: 14 }, [...allocations.map((a) => pill(a, true)), ...(chain ? [pill(chain, false)] : [])]),
        el("div", { display: "flex", fontSize: 26, color: C.muted }, status),
      ]),
    ],
  );

  const res = new ImageResponse(root as unknown as ConstructorParameters<typeof ImageResponse>[0], { width: 1200, height: 630, fonts });
  return Buffer.from(await res.arrayBuffer());
}
