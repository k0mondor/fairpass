import "dotenv/config";

import { createApp } from "./app.js";
import { loadAuthConfig } from "./config/auth.js";
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { UserRepository } from "./db/repositories/user-repository.js";
import { createApiRouter } from "./routes/index.js";
import { AuthService } from "./services/auth-service.js";
import { DemoTokenService } from "./services/demo-token-service.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const database = openDatabase(
  process.env.SQLITE_PATH ?? "./data/fairpass.sqlite",
);
runMigrations(database);

const users = new UserRepository(database);
const tokens = new DemoTokenService(loadAuthConfig());
const auth = new AuthService(users, tokens);
const app = createApp({ apiRouter: createApiRouter({ auth }) });

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`FairPass backend listening on http://127.0.0.1:${port}`);
});

let isShuttingDown = false;
const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  server.close((error) => {
    database.close();
    if (error) {
      console.error("Failed to stop the HTTP server", error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
