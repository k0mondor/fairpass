import type { RequestHandler } from "express";

export type LogValue = string | number | boolean | null;
export type LogRecord = Record<string, LogValue>;
export type LogSink = (record: LogRecord) => void;

export const consoleLogSink: LogSink = (record) => {
  console.info(JSON.stringify(record));
};

const resourceIdFromPath = (
  path: string,
  resourceName: "events" | "tickets",
): string | undefined => {
  const parts = path.split("/").filter(Boolean);
  const resourceIndex = parts.indexOf(resourceName);
  const candidate = parts[resourceIndex + 1];

  return resourceIndex >= 0 && candidate ? candidate : undefined;
};

export const requestLogger = (sink: LogSink = consoleLogSink): RequestHandler =>
  (request, response, next) => {
    const startedAt = process.hrtime.bigint();

    response.on("finish", () => {
      const durationNs = process.hrtime.bigint() - startedAt;
      const record: LogRecord = {
        level: "info",
        message: "request_completed",
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(durationNs) / 1_000_000,
      };

      const actorId = request.actor?.id;
      const eventId = resourceIdFromPath(request.path, "events");
      const ticketId = resourceIdFromPath(request.path, "tickets");
      const txId = response.locals.txId;
      const errorCode = response.locals.errorCode;

      if (actorId) record.actorId = actorId;
      if (eventId) record.eventId = eventId;
      if (ticketId) record.ticketId = ticketId;
      if (typeof txId === "string") record.txId = txId;
      if (typeof errorCode === "string") record.errorCode = errorCode;

      sink(record);
    });

    next();
  };
