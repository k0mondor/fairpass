export interface FabricConfig {
  gatewayMode: "mock" | "real";
  channelName: string;
  chaincodeName: string;
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  clientCertPath: string;
  clientKeyPath: string;
}

const gatewayMode = (value: string | undefined): "mock" | "real" => {
  const mode = value ?? "mock";
  if (mode !== "mock" && mode !== "real") {
    throw new Error("FABRIC_GATEWAY_MODE must be mock or real");
  }
  return mode;
};

export const loadFabricConfig = (): FabricConfig => ({
  gatewayMode: gatewayMode(process.env.FABRIC_GATEWAY_MODE),
  channelName: process.env.FABRIC_CHANNEL_NAME ?? "mychannel",
  chaincodeName: process.env.FABRIC_CHAINCODE_NAME ?? "fairpass",
  mspId: process.env.FABRIC_MSP_ID ?? "Org1MSP",
  peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? "localhost:7051",
  peerHostAlias:
    process.env.FABRIC_PEER_HOST_ALIAS ?? "peer0.org1.example.com",
  tlsCertPath: process.env.FABRIC_TLS_CERT_PATH ?? "",
  clientCertPath: process.env.FABRIC_CLIENT_CERT_PATH ?? "",
  clientKeyPath: process.env.FABRIC_CLIENT_KEY_PATH ?? "",
});
