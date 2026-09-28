import type { RequestHandler } from "express";

import { ApiError } from "../errors/api-error.js";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApiError("NOT_FOUND", "资源不存在"));
};
