import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { common } from "@hyperledger/fabric-protos";

import { Client, credentials, status as grpcStatus } from "@grpc/grpc-js";
import {
  connect,
  hash,
  signers,
  type Contract,
} from "@hyperledger/fabric-gateway";

import type { FabricConfig } from "../config/fabric.js";
import type { Operation } from "../types/domain.js";
import { GatewayError, parseChaincodeError } from "./gateway-error.js";
import type {
  ConfirmedSubmit,
  EvaluateMethod,
  GatewayAdapter,
  SubmitMethod,
} from "./types.js";

export interface FabricConnection {
  contract: Pick<Contract, "evaluateTransaction" | "newProposal">;
  queryBlockByTxId(txId: string): Promise<Uint8Array>;
  close(): void;
}

export function openFabricConnection(config: FabricConfig): FabricConnection {
  for (const field of [
    "tlsCertPath",
    "clientCertPath",
    "clientKeyPath",
  ] as const) {
    if (!config[field])
      throw new Error(`Fabric configuration missing ${field}`);
  }
  const tls = readFileSync(config.tlsCertPath);
  const certificate = readFileSync(config.clientCertPath);
  const key = createPrivateKey(readFileSync(config.clientKeyPath));
  const client = new Client(config.peerEndpoint, credentials.createSsl(tls), {
    "grpc.ssl_target_name_override": config.peerHostAlias,
    "grpc.default_authority": config.peerHostAlias,
  });
  try {
    const gateway = connect({
      client,
      identity: { mspId: config.mspId, credentials: certificate },
      signer: signers.newPrivateKeySigner(key),
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 10_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 10_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
    });
    return {
      contract: gateway
        .getNetwork(config.channelName)
        .getContract(config.chaincodeName),
      queryBlockByTxId(txId) {
        return gateway.getNetwork(config.channelName).getContract("qscc")
          .evaluateTransaction("GetBlockByTxID", config.channelName, txId);
      },
      close() {
        gateway.close();
        client.close();
      },
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

export class RealGatewayAdapter implements GatewayAdapter {
  readonly mode = "fabric" as const;
  private connection: FabricConnection | undefined;
  private readonly blockNumbers = new Map<string, number>();

  constructor(
    private readonly config: FabricConfig,
    private readonly connectionFactory = openFabricConnection,
  ) {}

  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  private contract() {
    this.connection ??= this.connectionFactory(this.config);
    return this.connection.contract;
  }

  async evaluate<T>(
    method: EvaluateMethod,
    args: readonly string[],
  ): Promise<T> {
    try {
      const result = this.decode<unknown>(
        await this.contract().evaluateTransaction(method, ...args),
      );
      if (
        method === "GetOperationsByEvent" ||
        method === "GetOperationsByTicket"
      ) {
        if (!Array.isArray(result))
          throw new Error("Fabric history must be an array");
        return await Promise.all(result.map(async (operation) => {
          const txId = operation?.txId;
          if (typeof txId !== "string" || !txId) throw new Error("Missing history transaction ID");
          let blockNumber = this.blockNumbers.get(txId);
          if (blockNumber === undefined) {
            const block = common.Block.deserializeBinary(await this.connection!.queryBlockByTxId(txId));
            blockNumber = block.getHeader()?.getNumber();
            if (blockNumber === undefined || !Number.isSafeInteger(blockNumber) || blockNumber < 0)
              throw new Error("Invalid Fabric block number");
            if (this.blockNumbers.size >= 5000) this.blockNumbers.clear();
            this.blockNumbers.set(txId, blockNumber);
          }
          return this.operation(operation, blockNumber);
        })) as T;
      }
      return result as T;
    } catch (error) {
      throw this.mapError(error, "NETWORK");
    }
  }

  async submitAndConfirm<T>(
    method: SubmitMethod,
    args: readonly string[],
  ): Promise<ConfirmedSubmit<T>> {
    let txId: string | undefined;
    let stage: "ENDORSEMENT" | "COMMIT_UNKNOWN" = "ENDORSEMENT";
    try {
      const contract = this.contract();
      const proposal = contract.newProposal(method, { arguments: [...args] });
      txId = proposal.getTransactionId();
      const transaction = await proposal.endorse();
      stage = "COMMIT_UNKNOWN";
      const submitted = await transaction.submit();
      const status = await submitted.getStatus();
      if (!status.successful) {
        throw new GatewayError(
          "COMMIT",
          `Fabric commit rejected with code ${status.code}`,
          { txId },
        );
      }
      const blockNumber =
        status.blockNumber <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(status.blockNumber)
          : null;
      if (blockNumber !== null) this.blockNumbers.set(txId, blockNumber);
      const result = this.decode<T>(transaction.getResult());
      const isEvent = method === "CreateEvent" || method === "PublishDraw";
      const ticketId =
        !isEvent && method === "ClaimTicket"
          ? (result as { id: string }).id
          : args[0]!;
      const history = this.decode<unknown>(
        await contract.evaluateTransaction(
          isEvent ? "GetOperationsByEvent" : "GetOperationsByTicket",
          isEvent ? args[0]! : ticketId,
        ),
      );
      if (!Array.isArray(history))
        throw new Error("Fabric history must be an array");
      const matches = history.filter((value) => value?.txId === txId);
      if (matches.length !== 1)
        throw new Error(
          "Confirmed transaction operation not found or duplicated",
        );
      return {
        result,
        txId,
        commitStatus: "VALID",
        blockNumber,
        gatewayMode: this.mode,
        operation: this.operation(matches[0], blockNumber),
      };
    } catch (error) {
      throw this.mapError(error, stage, txId);
    }
  }

  private decode<T>(bytes: Uint8Array): T {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
  }

  private operation(value: unknown, blockNumber: number | null): Operation {
    if (!value || typeof value !== "object")
      throw new Error("Invalid Fabric operation");
    return {
      ...value,
      channelName: this.config.channelName,
      chaincodeName: this.config.chaincodeName,
      blockNumber,
    } as Operation;
  }

  private mapError(
    error: unknown,
    fallback: "NETWORK" | "ENDORSEMENT" | "COMMIT_UNKNOWN",
    txId?: string,
  ): GatewayError {
    if (error instanceof GatewayError) return error;
    const detail = error as {
      message?: string;
      details?: { message?: string }[];
      code?: number;
    };
    const messages = [
      detail?.message ?? String(error),
      ...(Array.isArray(detail?.details)
        ? detail.details.map((entry) => entry.message ?? "")
        : []),
    ];
    for (const message of messages) {
      const parsed = parseChaincodeError(new Error(message));
      if (parsed.kind === "BUSINESS")
        return new GatewayError("BUSINESS", message, {
          businessCode: parsed.businessCode!,
          ...(txId ? { txId } : {}),
          cause: error,
        });
    }
    const kind =
      fallback === "COMMIT_UNKNOWN"
        ? fallback
        : detail?.code === grpcStatus.DEADLINE_EXCEEDED
          ? "TIMEOUT"
          : fallback;
    return new GatewayError(kind, "Fabric Gateway request failed", {
      ...(txId ? { txId } : {}),
      cause: error,
    });
  }
}
