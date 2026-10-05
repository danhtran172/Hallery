import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

// Geist ships no Vietnamese subset, so every "ệ" or "ữ" fell back to another typeface
// mid-word. Inter covers the full Vietnamese range.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Hallery", template: "%s · Hallery" },
  description: "Gallery cho dữ liệu Notion — bạn quyết định mỗi property hiển thị ra sao.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
