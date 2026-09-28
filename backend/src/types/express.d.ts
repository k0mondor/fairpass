import type { User } from "./domain.js";

export {};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      actor?: User;
    }
  }
}
