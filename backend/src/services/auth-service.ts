import { ApiError } from "../errors/api-error.js";
import type { UserRepository } from "../db/repositories/user-repository.js";
import type { User } from "../types/domain.js";
import type { DemoTokenService } from "./demo-token-service.js";

export interface LoginResult {
  token: string;
  user: User;
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: DemoTokenService,
  ) {}

  async login(account: string): Promise<LoginResult> {
    const user = this.users.findByAccount(account);
    if (!user) throw new ApiError("UNAUTHENTICATED", "演示账号不存在");

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
