// ════════════════════════════════════════════════════════════════════════════
//  CAPRO — local embedded PostgreSQL control script
//  Runs a real, self-contained Postgres 16 server in userspace (no system
//  install, no sudo). Data persists in ./.pgdata (gitignored).
//
//    node scripts/db.mjs start   → init (first run) + start, then stay alive
//    node scripts/db.mjs init    → init + start + createDatabase, then stop
// ════════════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, ".pgdata");
const DB_NAME = "capro";

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "capro",
  password: "capro",
  port: 5432,
  persistent: true,
});

async function ensureCluster() {
  // PG_VERSION exists once a cluster has been initialised in DATA_DIR.
  if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
    console.log("[db] initialising new cluster in .pgdata …");
    await pg.initialise();
  }
}

async function ensureDatabase() {
  try {
    await pg.createDatabase(DB_NAME);
    console.log(`[db] created database "${DB_NAME}"`);
  } catch (err) {
    if (String(err?.message ?? err).includes("already exists")) {
      console.log(`[db] database "${DB_NAME}" already exists`);
    } else {
      throw err;
    }
  }
}

const mode = process.argv[2] ?? "start";

if (mode === "init") {
  await ensureCluster();
  await pg.start();
  await ensureDatabase();
  await pg.stop();
  console.log("[db] init complete");
  process.exit(0);
}

// mode === "start": boot and stay alive so the dev server can connect.
await ensureCluster();
await pg.start();
await ensureDatabase();
console.log("[db] PostgreSQL ready on postgresql://capro:capro@localhost:5432/capro");

const shutdown = async () => {
  console.log("\n[db] stopping PostgreSQL …");
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the process alive.
setInterval(() => {}, 1 << 30);
