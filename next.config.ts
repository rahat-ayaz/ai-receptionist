import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Node-only libraries out of the bundler (required at runtime instead).
  serverExternalPackages: ["twilio", "@prisma/client", "pdf-parse", "mammoth", "xlsx"],
  // Emit a self-contained server bundle with only the traced dependencies, so
  // the container image does not ship the full node_modules tree.
  //
  // Off on Vercel: its build pipeline does its own tracing and does not need
  // this, and production still deploys there until the Cloud Run cutover — so
  // the migration must not change how the live build is produced.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
