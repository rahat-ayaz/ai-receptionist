import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Node-only libraries out of the bundler (required at runtime instead).
  serverExternalPackages: ["twilio", "@prisma/client", "pdf-parse", "mammoth", "xlsx"],
  // Emit a self-contained server bundle with only the traced dependencies, so
  // the container image does not ship the full node_modules tree.
  output: "standalone",
};

export default nextConfig;
