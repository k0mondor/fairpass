import { scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "../errors/api-error.js";
import type { UserRepository } from "../db/repositories/user-repository.js";
import type { Role, User } from "../types/domain.js";
import type { DemoTokenService } from "./demo-token-service.js";

export interface LoginResult {
  token: string;
  user: User;
}

const derivePassword = promisify(scrypt);

export class AuthService {
  private readonly passwordHash = scryptSync(
    process.env.DEMO_LOGIN_PASSWORD ?? "123456",
    "fairpass-local-login",
    32,
  );
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: DemoTokenService,
  ) {}

  async login(
    account: string,
    password: string,
    role: Role,
  ): Promise<LoginResult> {
    const user = this.users.findByAccount(account);
    const candidate = (await derivePassword(
      password,
      "fairpass-local-login",
      32,
    )) as Buffer;
    const validPassword = timingSafeEqual(candidate, this.passwordHash);
    if (!user || !validPassword || user.role !== role) {
      throw new ApiError("UNAUTHENTICATED", "账号、密码或登录身份不正确");
    }

    return { token: await this.tokens.sign(user), user };
  }

  async authenticate(token: string): Promise<User> {
    let claims;
    try {
      claims = await this.tokens.verify(token);
    } catch {
      throw new ApiError("UNAUTHENTICATED", "登录凭证无效或已过期");
    }

    const user = this.users.findById(claims.userId);
    if (!user || user.role !== claims.role) {
      throw new ApiError("UNAUTHENTICATED", "登录凭证无效或已过期");
    }

    return user;
  }
}
