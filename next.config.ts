import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A phone on the same Wi-Fi opens the dev server by the PC's LAN address; without this
  // Next refuses its dev assets and the page never hydrates. Private ranges only.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.ts.net"],
  async headers() {
    return [
      {
        // The worker must never be served from cache, or a fixed sw.js would never reach phones.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // "+ Thêm item" uploads its picture through a server action. The default 1 MB cap
      // rejected an ordinary phone photo and showed the error page; 20 MB is Notion's own
      // single-part upload limit (MAX_UPLOAD_BYTES), plus room for the other fields.
      bodySizeLimit: "21mb",
    },
  },
};

export default nextConfig;
