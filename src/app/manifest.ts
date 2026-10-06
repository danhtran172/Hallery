import type { MetadataRoute } from "next";

/**
 * What a phone needs to install Hallery to its home screen and open it without the
 * browser's address bar. The colours are the light canvas, so the splash screen and the
 * status bar meet the app's own frame instead of flashing white.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hallery",
    short_name: "Hallery",
    description: "Gallery cho dữ liệu Notion — bạn quyết định mỗi property hiển thị ra sao.",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eeede8",
    theme_color: "#eeede8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
