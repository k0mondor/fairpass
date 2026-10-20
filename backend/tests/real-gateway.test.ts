import { common } from "@hyperledger/fabric-protos";
import { describe, expect, it, vi } from "vitest";
import type { Contract } from "@hyperledger/fabric-gateway";
import { loadFabricConfig } from "../src/config/fabric.js";
import {
  RealGatewayAdapter,
  type FabricConnection,
} from "../src/fabric/real-gateway-adapter.js";

const txId = "a".repeat(64);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const operation = {
  id: txId,
  txId,
  eventId: "event",
  ticketId: "ticket",
  type: "TICKET_REDEEMED",
  actorId: "inspector",
  fromUserId: "owner",
  toUserId: null,
  occurredAt: "2026-10-14T00:00:00.000Z",
};

function setup(
  options: {
    successful?: boolean;
    statusError?: Error;
    endorseError?: Error;
  } = {},
) {
  const getStatus = vi.fn(async () => {
    if (options.statusError) throw options.statusError;
    return {
      successful: options.successful ?? true,
      code: 0,
      blockNumber: 8n,
      transactionId: txId,
    };
  });
  const submit = vi.fn(async () => ({ getStatus }));
  const getResult = vi.fn(() => encode({ id: "ticket", status: "REDEEMED" }));
  const endorse = vi.fn(async () => {
    if (options.endorseError) throw options.endorseError;
    return { submit, getResult };
  });
  const evaluateTransaction = vi.fn(async () => encode([operation]));
  const connection = {
    contract: {
      newProposal: vi.fn(() => ({ getTransactionId: () => txId, endorse })),
      evaluateTransaction,
    } as unknown as Pick<Contract, "evaluateTransaction" | "newProposal">,
    queryBlockByTxId: vi.fn(async () => {
      const block = new common.Block();
      const header = new common.BlockHeader();
      header.setNumber(8);
      block.setHeader(header);
      return block.serializeBinary();
    }),
    close: vi.fn(),
  } satisfies FabricConnection;
  const gateway = new RealGatewayAdapter(
    {
      ...loadFabricConfig(),
      channelName: "mychannel",
      chaincodeName: "fairpass",
    },
    () => connection,
  );
  return {
    gateway,
    getStatus,
    submit,
    getResult,
    endorse,
    evaluateTransaction,
    connection,
  };
}

describe("Real Fabric Gateway commit boundary", () => {
  it("waits for VALID commit and selects the exact transaction operation", async () => {
    const ctx = setup();
    ctx.evaluateTransaction.mockResolvedValue(
      encode([{ ...operation, id: "other", txId: "other" }, operation]),
    );
    const result = await ctx.gateway.submitAndConfirm("RedeemTicket", [
      "ticket",
      "inspector",
    ]);
    expect(result).toMatchObject({
      txId,
      commitStatus: "VALID",
      gatewayMode: "fabric",
      blockNumber: 8,
      operation: {
        ...operation,
        channelName: "mychannel",
        chaincodeName: "fairpass",
        blockNumber: 8,
      },
    });
    expect(ctx.getStatus).toHaveBeenCalledOnce();
    expect(ctx.evaluateTransaction).toHaveBeenCalledWith(
      "GetOperationsByTicket",
      "ticket",
    );
    ctx.gateway.close();
    expect(ctx.connection.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid commit without exposing the endorsed result as success", async () => {
    const ctx = setup({ successful: false });
    await expect(
      ctx.gateway.submitAndConfirm("RedeemTicket", ["ticket", "inspector"]),
    ).rejects.toMatchObject({ kind: "COMMIT", txId });
    expect(ctx.getResult).not.toHaveBeenCalled();
    expect(ctx.evaluateTransaction).not.toHaveBeenCalled();
  });

  it("keeps the transaction ID when commit status is unknown", async () => {
    const ctx = setup({ statusError: new Error("connection lost") });
    await expect(
      ctx.gateway.submitAndConfirm("RedeemTicket", ["ticket", "inspector"]),
    ).rejects.toMatchObject({ kind: "COMMIT_UNKNOWN", txId });
  });

  it("extracts business rejection from SDK peer details", async () => {
    const error = Object.assign(new Error("endorsement failed"), {
      details: [{ message: "ALREADY_REDEEMED:ticket used" }],
    });
    const ctx = setup({ endorseError: error });
    await expect(
      ctx.gateway.submitAndConfirm("RedeemTicket", ["ticket", "inspector"]),
    ).rejects.toMatchObject({
      kind: "BUSINESS",
      businessCode: "ALREADY_REDEEMED",
    });
    expect(ctx.submit).not.toHaveBeenCalled();
  });

  it("retrieves real block numbers for history and caches immutable results", async () => {
    const ctx = setup();
    await expect(
      ctx.gateway.evaluate("GetOperationsByTicket", ["ticket"]),
    ).resolves.toEqual([
      {
        ...operation,
        channelName: "mychannel",
        chaincodeName: "fairpass",
        blockNumber: 8,
      },
    ]);
  });

  it("reuses queried block numbers on subsequent history reads", async () => {
    const ctx = setup();
    await ctx.gateway.evaluate("GetOperationsByTicket", ["ticket"]);
    await ctx.gateway.evaluate("GetOperationsByTicket", ["ticket"]);
    expect(ctx.connection.queryBlockByTxId).toHaveBeenCalledExactlyOnceWith(txId);
  });

  it("fails history explicitly if the block lookup fails", async () => {
    const ctx = setup();
    ctx.connection.queryBlockByTxId.mockRejectedValueOnce(new Error("peer unavailable"));
    await expect(ctx.gateway.evaluate("GetOperationsByTicket", ["ticket"]))
      .rejects.toMatchObject({ kind: "NETWORK" });
  });

  it("reports confirmed writes with missing history as unknown for reconciliation", async () => {
    const ctx = setup();
    ctx.evaluateTransaction.mockResolvedValue(encode([]));
    await expect(
      ctx.gateway.submitAndConfirm("RedeemTicket", ["ticket", "inspector"]),
    ).rejects.toMatchObject({ kind: "COMMIT_UNKNOWN", txId });
  });
});
