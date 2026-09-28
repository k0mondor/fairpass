import cors, { type CorsOptions } from "cors";
import express, { Router } from "express";

import { loadHttpConfig, type HttpConfig } from "./config/http.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import {
  consoleLogSink,
  type LogSink,
  requestLogger,
} from "./middleware/request-logger.js";
import { requestId } from "./middleware/request-id.js";

export interface CreateAppOptions {
  config?: HttpConfig;
  apiRouter?: Router;
  logSink?: LogSink;
}

const createCorsOptions = (allowedOrigins: readonly string[]): CorsOptions => ({
  origin(origin, callback) {
    if (origin === undefined || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  optionsSuccessStatus: 204,
});

export const createApp = (options: CreateAppOptions = {}) => {
  const config = options.config ?? loadHttpConfig();
  const apiRouter = options.apiRouter ?? Router();
  const logSink = options.logSink ?? consoleLogSink;
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(requestLogger(logSink));
  app.use(cors(createCorsOptions(config.corsOrigins)));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
