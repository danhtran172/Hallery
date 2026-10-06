import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Be_Vietnam_Pro, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ACCENT_COOKIE, THEME_COOKIE, parseAccent, parseTheme } from "@/lib/appearance";

// Be Vietnam Pro was drawn for Vietnamese first, so stacked marks like "ệ" or "ữ" sit
// where a native reader expects them rather than as Latin glyphs with accents bolted on.
const body = Be_Vietnam_Pro({
  variable: "--font-body",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Headings only: a grotesque with enough character to make the app recognisable at a glance.
const display = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin", "vietnamese"],
  axes: ["wdth", "opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Hallery", template: "%s · Hallery" },
  description: "Gallery cho dữ liệu Notion — bạn quyết định mỗi property hiển thị ra sao.",
  // iOS ignores most of the manifest: these make "Thêm vào MH chính" open full-screen.
  appleWebApp: { capable: true, title: "Hallery", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eeede8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The appearance lives in a cookie so it is right in the very first HTML — no flash of
  // the light theme before a script could correct it.
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const accent = parseAccent(jar.get(ACCENT_COOKIE)?.value);

  return (
    <html
      lang="vi"
      data-theme={theme}
      data-accent={accent}
      className={`${body.variable} ${display.variable} h-full antialiased`}
      // The appearance control rewrites both attributes in place.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
