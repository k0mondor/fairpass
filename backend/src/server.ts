import "dotenv/config";

import { createApp } from "./app.js";
import { loadAuthConfig } from "./config/auth.js";
import { loadFabricConfig } from "./config/fabric.js";
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { DrawRepository } from "./db/repositories/draw-repository.js";
import { EventRepository } from "./db/repositories/event-repository.js";
import { IdempotencyRepository } from "./db/repositories/idempotency-repository.js";
import { RegistrationRepository } from "./db/repositories/registration-repository.js";
import { UserRepository } from "./db/repositories/user-repository.js";
import { createGatewayAdapter } from "./fabric/create-gateway-adapter.js";
import { createApiRouter } from "./routes/index.js";
import { AuthService } from "./services/auth-service.js";
import { DemoTokenService } from "./services/demo-token-service.js";
import { DrawService } from "./services/draw-service.js";
import { EventCreationService } from "./services/event-creation-service.js";
import { EventService } from "./services/event-service.js";
import { GatewayLedgerReadService } from "./services/ledger-read-service.js";
import { OperationService } from "./services/operation-service.js";
import { RegistrationService } from "./services/registration-service.js";
import { TicketService } from "./services/ticket-service.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const database = openDatabase(
  process.env.SQLITE_PATH ?? "./data/fairpass.sqlite",
);
runMigrations(database);

const users = new UserRepository(database);
const eventRepository = new EventRepository(database);
const drawRepository = new DrawRepository(database);
const idempotencyRepository = new IdempotencyRepository(database);
const registrationRepository = new RegistrationRepository(database);
const tokens = new DemoTokenService(loadAuthConfig());
const auth = new AuthService(users, tokens);
const fabricConfig = loadFabricConfig();
const gateway = createGatewayAdapter(fabricConfig);
const ledger = new GatewayLedgerReadService(gateway);
const events = new EventService(eventRepository, registrationRepository, ledger);
const eventCreation = new EventCreationService(
  database,
  eventRepository,
  idempotencyRepository,
  gateway,
  events,
);
const registrations = new RegistrationService(
  database,
  registrationRepository,
  events,
);
const draws = new DrawService(
  database,
  eventRepository,
  drawRepository,
  gateway,
);
const tickets = new TicketService(
  drawRepository,
  users,
  gateway,
  events,
);
const operations = new OperationService(gateway, events, tickets);
const app = createApp({
  apiRouter: createApiRouter({
    auth,
    draws,
    eventCreation,
    events,
    operations,
    registrations,
    tickets,
  }),
});

if (gateway.mode === "mock") {
  console.warn(
    "Fabric Gateway mode is mock: transactions are simulated, use mock-* txIds, and are not on-chain.",
  );
}

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
