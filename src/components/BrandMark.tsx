/** The "А" mark: a letter drawn as a mountain peak (Ала-Тоо) with a morning sun. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="18" fill="var(--c-brand, #286647)" />
      <circle cx="46" cy="18" r="5.5" fill="#f6c453" />
      <path
        d="M17 48 31 16l14 32"
        fill="none"
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M23 37h16" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  )
}
