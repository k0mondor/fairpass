import { GatewayError } from "./gateway-error.js";
import type {
  ConfirmedSubmit,
  EvaluateMethod,
  GatewayAdapter,
  SubmitMethod,
} from "./types.js";

export class UnavailableGatewayAdapter implements GatewayAdapter {
  readonly mode = "fabric" as const;

  constructor(private readonly reason: string) {}

  async evaluate<T>(
    _method: EvaluateMethod,
    _args: readonly string[],
  ): Promise<T> {
    throw new GatewayError("NETWORK", this.reason);
  }

  async submitAndConfirm<T>(
    _method: SubmitMethod,
    _args: readonly string[],
  ): Promise<ConfirmedSubmit<T>> {
    throw new GatewayError("NETWORK", this.reason);
  }
}
