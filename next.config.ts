import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Node-only libraries out of the bundler (required at runtime instead).
  serverExternalPackages: ["twilio", "@prisma/client", "pdf-parse", "mammoth", "xlsx"],
};

export default nextConfig;
