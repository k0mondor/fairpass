import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { openDatabase } from "../dist/db/client.js";
import { runMigrations } from "../dist/db/migrate.js";
import { seedDemoUsers } from "../dist/db/seed.js";

// Each run pairs a new SQLite database with a new in-memory Mock ledger.
// Existing databases and the real Fabric network are never reset.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const directory = new URL(`../../.local/mock-${randomUUID()}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(port),
  SQLITE_PATH: fileURLToPath(new URL("fairpass.sqlite", directory)),
  FABRIC_GATEWAY_MODE: "mock",
  DEMO_TOKEN_SECRET: randomBytes(32).toString("hex"),
  DEMO_LOGIN_PASSWORD: "123456",
  API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
  DEMO_STATE_DIR: directory.href,
  DEMO_ALLOW_MOCK: "1",
};
const database = openDatabase(env.SQLITE_PATH);
runMigrations(database);
seedDemoUsers(database);
database.close();
const children = new Set();
let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
function launch(script, stdio = "inherit") {
  const child = spawn(process.execPath, [script], { cwd, env, stdio });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
const server = launch("dist/server.js", ["inherit", "pipe", "inherit"]);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Mock backend startup timed out")), 30_000);
    let output = "";
    server.stdout.on("data", (data) => {
      process.stdout.write(data);
      output += data.toString();
      if (output.includes("FairPass backend listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Mock backend exited before startup; check port availability")); });
  });
  server.once("exit", (code) => {
    if (!stopping) { process.exitCode = code || 1; stop(); }
  });
  for (const script of ["scripts/seed-campus-demo.mjs", "scripts/prepare-interactive-demo.mjs"]) {
    await new Promise((resolve, reject) => {
      const child = launch(script);
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
    });
  }
  console.log(`READY: clean Mock demo at ${env.API_BASE_URL}; frontend may now log in. Ctrl+C to stop.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  stop();
}
