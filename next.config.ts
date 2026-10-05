import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
