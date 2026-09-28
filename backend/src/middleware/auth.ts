import type { RequestHandler } from "express";

import { ApiError } from "../errors/api-error.js";
import type { AuthService } from "../services/auth-service.js";
import type { Role } from "../types/domain.js";

const bearerToken = (authorization: string | undefined): string => {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) throw new ApiError("UNAUTHENTICATED", "请先登录");
  return match[1];
};

export const requireAuth = (auth: AuthService): RequestHandler =>
  async (request, _response, next) => {
    try {
      const token = bearerToken(request.header("Authorization"));
      request.actor = await auth.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireRole = (...allowedRoles: readonly Role[]): RequestHandler =>
  (request, _response, next) => {
    if (!request.actor) {
      next(new ApiError("UNAUTHENTICATED", "请先登录"));
      return;
    }
    if (!allowedRoles.includes(request.actor.role)) {
      next(new ApiError("FORBIDDEN", "当前身份无权执行此操作"));
      return;
    }
    next();
  };
