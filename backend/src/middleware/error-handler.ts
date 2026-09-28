import type { ErrorRequestHandler } from "express";

import { ApiError } from "../errors/api-error.js";

interface HttpLikeError extends Error {
  status?: number;
  statusCode?: number;
}

const isHttpLikeError = (error: unknown): error is HttpLikeError =>
  error instanceof Error;

const normalizeError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;

  if (isHttpLikeError(error)) {
    const status = error.status ?? error.statusCode;
    if (status === 400 || status === 413) {
      return new ApiError("VALIDATION_ERROR", "请求内容无效", { cause: error });
    }
  }

  return new ApiError("INTERNAL_ERROR", "服务器内部错误", { cause: error });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  const apiError = normalizeError(error);
  response.locals.errorCode = apiError.code;

  response.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: request.requestId,
    },
  });
};
