import {
  ApiError,
  errorStatusByCode,
  type ApiErrorCode,
} from "../errors/api-error.js";

export type GatewayErrorKind =
  | "BUSINESS"
  | "NETWORK"
  | "TIMEOUT"
  | "ENDORSEMENT"
  | "COMMIT"
  | "COMMIT_UNKNOWN"
  | "UNKNOWN";

export interface GatewayErrorOptions extends ErrorOptions {
  businessCode?: ApiErrorCode;
  txId?: string;
}

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly businessCode: ApiErrorCode | undefined;
  readonly txId: string | undefined;

  constructor(
    kind: GatewayErrorKind,
    message: string,
    options: GatewayErrorOptions = {},
  ) {
    super(message, options);
    this.name = "GatewayError";
    this.kind = kind;
    this.businessCode = options.businessCode;
    this.txId = options.txId;
  }
}

const publicMessages: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "链上请求参数无效",
  UNAUTHENTICATED: "登录凭证无效或已过期",
  FORBIDDEN: "当前身份无权执行此操作",
  NOT_TICKET_OWNER: "当前用户不是票的持有人",
  NOT_FOUND: "链上资源不存在",
  IDEMPOTENCY_CONFLICT: "幂等请求发生冲突",
  ALREADY_REGISTERED: "已报名",
  DRAW_IN_PROGRESS: "抽签正在处理中",
  ALREADY_DRAWN: "活动已经完成抽签",
  NOT_WINNER: "当前用户未中签",
  ALREADY_CLAIMED: "票已领取",
  SOLD_OUT: "名额已满",
  TRANSFER_LIMIT_REACHED: "票已达到转让次数上限",
  INVALID_RECIPIENT: "接收人无效",
  ALREADY_REDEEMED: "票已核销",
  REGISTRATION_CLOSED: "报名已截止",
  DRAW_NOT_READY: "当前不能抽签",
  CLAIM_CLOSED: "领票已截止",
  TRANSFER_CLOSED: "转让已截止",
  CHECKIN_CLOSED: "当前不在检票时间内",
  FABRIC_UNAVAILABLE: "Fabric Gateway 暂不可用",
  INTERNAL_ERROR: "服务器内部错误",
};

const isApiErrorCode = (value: string): value is ApiErrorCode =>
  Object.hasOwn(errorStatusByCode, value);

export const parseChaincodeError = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error;

  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(/(?:^|\s)([A-Z][A-Z0-9_]+):/);
  const code = match?.[1];
  if (code && isApiErrorCode(code)) {
    return new GatewayError("BUSINESS", detail, {
      businessCode: code,
      cause: error,
    });
  }

  return new GatewayError("UNKNOWN", "Unknown Fabric Gateway error", {
    cause: error,
  });
};

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;

  const gatewayError = parseChaincodeError(error);
  if (gatewayError.kind === "BUSINESS" && gatewayError.businessCode) {
    return new ApiError(
      gatewayError.businessCode,
      publicMessages[gatewayError.businessCode],
      { cause: error },
    );
  }

  return new ApiError("FABRIC_UNAVAILABLE", publicMessages.FABRIC_UNAVAILABLE, {
    cause: error,
  });
};

export const businessError = (
  code: ApiErrorCode,
  internalMessage: string,
): GatewayError =>
  new GatewayError("BUSINESS", `${code}:${internalMessage}`, {
    businessCode: code,
  });
