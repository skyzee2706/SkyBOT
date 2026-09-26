// Logo SkyBOT (SVG) — dipakai di header, halaman login, dll. Tidak memakai emoji supaya tampil sama di semua perangkat.
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="skybot-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#skybot-logo)" />
      <path
        d="M14 22a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v4a6 6 0 0 0 0 12v4a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4v-4a6 6 0 0 0 0-12z"
        fill="#fff"
      />
      <path d="M38 20v24" stroke="#6366f1" strokeWidth="2.5" strokeDasharray="3 3" />
    </svg>
  );
}
