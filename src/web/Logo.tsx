// Logo SkyBOT (gambar, bukan emoji) — dipakai di header, halaman login, dll.
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={`${className} rounded-lg object-cover`} />;
}
