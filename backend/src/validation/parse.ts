import type { z } from "zod";

import { ApiError } from "../errors/api-error.js";

export const parseInput = <Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): Output => {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const firstIssue = result.error.issues[0];
  const field = firstIssue?.path.join(".");
  const message = field ? `请求字段 ${field} 无效` : "请求内容无效";

  throw new ApiError("VALIDATION_ERROR", message, { cause: result.error });
};
