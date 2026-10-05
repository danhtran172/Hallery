/**
 * The app's icon set — a few dozen strokes drawn on one 24px grid, so every glyph shares
 * weight and corner radius. Replaces the text glyphs (☰ « ⌕ ✕) that each font drew at a
 * different size and baseline.
 */

const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M17.5 6.5 6.5 17.5M6.5 6.5l11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  "chevron-left": <path d="m14.5 18-6-6 6-6" />,
  "chevron-right": <path d="m9.5 18 6-6-6-6" />,
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  "arrow-left": <path d="M19 12H5m6 6-6-6 6-6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  "panel-left": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="4" />
      <path d="M9.5 4v16" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" />,
  sort: <path d="M7.5 4.5v15m-3.5-3.5 3.5 3.5 3.5-3.5M16.5 19.5v-15M13 8l3.5-3.5L20 8" />,
  layers: (
    <>
      <path d="m12 3.5 8.5 4.75L12 13 3.5 8.25z" />
      <path d="m3.5 12.5 8.5 4.75 8.5-4.75" />
    </>
  ),
  shuffle: <path d="M16 4.5h3.5V8M4.5 19.5l15-15M19.5 16v3.5H16m-1.5-5 5 5m-15-15 5 5" />,
  external: <path d="M14 4.5h5.5V10m0-5.5-8.5 8.5M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" />,
  refresh: (
    <>
      <path d="M19.5 11A7.5 7.5 0 0 0 6.2 6.8L4.5 8.5" />
      <path d="M4.5 4.5v4h4M4.5 13a7.5 7.5 0 0 0 13.3 4.2l1.7-1.7" />
      <path d="M19.5 19.5v-4h-4" />
    </>
  ),
  trash: <path d="M4.5 7h15m-9 4v6m3-6v6M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7m-8-0V4.5h5V7" />,
  restore: (
    <>
      <path d="M4.5 9.5h10a4.75 4.75 0 0 1 0 9.5H8" />
      <path d="m8 5.5-3.5 4 3.5 4" />
    </>
  ),
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6.5" r="1.3" />
      <circle cx="15" cy="6.5" r="1.3" />
      <circle cx="9" cy="12" r="1.3" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="9" cy="17.5" r="1.3" />
      <circle cx="15" cy="17.5" r="1.3" />
    </g>
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </g>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v1.9m0 14.6v1.9M5.5 5.5l1.3 1.3m10.4 10.4 1.3 1.3M2.8 12h1.9m14.6 0h1.9M5.5 18.5l1.3-1.3M17.2 6.8l1.3-1.3" />
    </>
  ),
  moon: <path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  home: <path d="M4.5 10.5 12 4.5l7.5 6V18.5a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5h-5v5H6a1.5 1.5 0 0 1-1.5-1.5z" />,
  pencil: (
    <>
      <path d="M15.2 4.8a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8.5 19.5H4.5v-4z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  plug: <path d="M9 3.5v4.5m6-4.5v4.5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5v4" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="M3.5 10.5h17m-9.5 0v10" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12V5a1.5 1.5 0 0 1 1.5-1.5h7l8.2 8.2a1.6 1.6 0 0 1 0 2.3l-6.2 6.2a1.6 1.6 0 0 1-2.3 0z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6.2 5.5 12 5.5 21.2 12 21.2 12 17.8 18.5 12 18.5 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a3.8 3.8 0 0 0 5.4 0l3.1-3.1a3.8 3.8 0 0 0-5.4-5.4l-1 1" />
      <path d="M14 10a3.8 3.8 0 0 0-5.4 0l-3.1 3.1a3.8 3.8 0 0 0 5.4 5.4l1-1" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-4.5-4.5-9.5 8" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.8a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z" />
      <path d="M12 10v3.5m0 3v.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7m-3 3 2.5 2.5m-5-0 2 2" />
    </>
  ),
  sparkle: <path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5zM18.5 15.5c.3 1.8 1 2.5 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.3 2.5-1 2.8-2.8z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-4 shrink-0"}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * Hallery's mark: four tiles of a gallery wall, one of them lit in the accent colour.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className ?? "size-6"}>
      <rect x="2" y="2" width="9" height="11.5" rx="3" fill="var(--color-brand)" />
      <rect x="13" y="2" width="9" height="7" rx="3" fill="currentColor" opacity="0.18" />
      <rect x="2" y="15.5" width="9" height="6.5" rx="3" fill="currentColor" opacity="0.18" />
      <rect x="13" y="11" width="9" height="11" rx="3" fill="currentColor" opacity="0.88" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-ink">
      <LogoMark className="size-6" />
      <span className="display text-[17px] leading-none">Hallery</span>
    </span>
  );
}
