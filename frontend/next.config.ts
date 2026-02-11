import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://takewalk_backend:8000/:path*", // Use Docker service name
      },
    ];
  },
};

export default nextConfig;