/**
 * Light/dark and accent colour — a per-browser preference kept in a cookie, so the server
 * renders <html> with the right attributes and the first paint is already correct. The CSS
 * does the rest: every token is a light-dark() pair, so "system" needs no script at all.
 */

export const THEME_COOKIE = "hallery-theme";
export const ACCENT_COOKIE = "hallery-accent";

export type ThemeChoice = "light" | "dark" | "system";

/** The five presets of the Phase 8 spec, default first. */
export const ACCENTS = [
  { id: "green", label: "Xanh lá", color: "#4b8b60" },
  { id: "blue", label: "Xanh dương", color: "#0055da" },
  { id: "teal", label: "Xanh ngọc", color: "#76abae" },
  { id: "pink", label: "Hồng", color: "#f5788b" },
  { id: "orange", label: "Cam", color: "#f7a00a" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Sáng" },
  { id: "dark", label: "Tối" },
  { id: "system", label: "Theo máy" },
];

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function parseAccent(value: string | undefined): AccentId {
  return ACCENTS.some((accent) => accent.id === value) ? (value as AccentId) : "green";
}

/** What the screen is actually showing right now. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function remember(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

let listeners: (() => void)[] = [];

/** A tiny external store so every control showing the preference stays in step. */
export const appearanceStore = {
  subscribe(callback: () => void) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((entry) => entry !== callback);
    };
  },
  theme: () => parseTheme(document.documentElement.dataset.theme),
  accent: () => parseAccent(document.documentElement.dataset.accent),
  setTheme(choice: ThemeChoice) {
    remember(THEME_COOKIE, choice);
    document.documentElement.dataset.theme = choice;
    listeners.forEach((callback) => callback());
  },
  setAccent(accent: AccentId) {
    remember(ACCENT_COOKIE, accent);
    document.documentElement.dataset.accent = accent;
    listeners.forEach((callback) => callback());
  },
};
