import "dotenv/config";
import { randomUUID } from "node:crypto";
import { loadFabricConfig } from "../config/fabric.js";
import type { ChainEvent } from "./types.js";
import { RealGatewayAdapter } from "./real-gateway-adapter.js";

const gateway = new RealGatewayAdapter({
  ...loadFabricConfig(),
  gatewayMode: "real",
});
try {
  const eventId = randomUUID();
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const end = new Date(Date.now() + 90_000_000).toISOString();
  const confirmed = await gateway.submitAndConfirm<ChainEvent>("CreateEvent", [
    eventId,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "1",
    start,
    end,
  ]);
  const read = await gateway.evaluate<ChainEvent>("GetEvent", [eventId]);
  if (read.eventId !== eventId)
    throw new Error("Gateway query returned a different event");
  console.log(
    JSON.stringify(
      {
        eventId,
        txId: confirmed.txId,
        commitStatus: confirmed.commitStatus,
        blockNumber: confirmed.blockNumber,
        queryMatched: true,
        gatewayMode: gateway.mode,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  gateway.close();
}
