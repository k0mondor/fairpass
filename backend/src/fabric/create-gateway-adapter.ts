import type { FabricConfig } from "../config/fabric.js";
import { MockGatewayAdapter } from "./mock-gateway-adapter.js";
import type { GatewayAdapter } from "./types.js";
import { RealGatewayAdapter } from "./real-gateway-adapter.js";

export const createGatewayAdapter = (config: FabricConfig): GatewayAdapter => {
  if (config.gatewayMode === "mock") {
    return new MockGatewayAdapter({
      channelName: config.channelName,
      chaincodeName: config.chaincodeName,
    });
  }

  return new RealGatewayAdapter(config);
};
