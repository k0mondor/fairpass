import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import type { AuthConfig } from "../config/auth.js";
import type { Role, User } from "../types/domain.js";
import { roleSchema } from "../validation/schemas.js";

export interface DemoTokenClaims {
  userId: string;
  role: Role;
}

export type Clock = () => number;

const systemClock: Clock = () => Math.floor(Date.now() / 1000);

export class DemoTokenService {
  constructor(
    private readonly config: AuthConfig,
    private readonly clock: Clock = systemClock,
  ) {}

  async sign(user: User): Promise<string> {
    const now = this.clock();

    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.ttlSeconds)
      .sign(this.config.secret);
  }

  async verify(token: string): Promise<DemoTokenClaims> {
    const { payload } = await jwtVerify(token, this.config.secret, {
      algorithms: ["HS256"],
      issuer: this.config.issuer,
      audience: this.config.audience,
      currentDate: new Date(this.clock() * 1000),
    });
    const role = roleSchema.parse(payload.role);

    if (!payload.sub) throw new Error("Token subject is missing");
    return { userId: payload.sub, role };
  }
}
