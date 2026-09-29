import type { FabricConfig } from "../config/fabric.js";
import { MockGatewayAdapter } from "./mock-gateway-adapter.js";
import type { GatewayAdapter } from "./types.js";
import { UnavailableGatewayAdapter } from "./unavailable-gateway-adapter.js";

export const createGatewayAdapter = (config: FabricConfig): GatewayAdapter => {
  if (config.gatewayMode === "mock") {
    return new MockGatewayAdapter({
      channelName: config.channelName,
      chaincodeName: config.chaincodeName,
    });
  }

  return new UnavailableGatewayAdapter(
    "Real Fabric Gateway adapter is not configured yet",
  );
};
