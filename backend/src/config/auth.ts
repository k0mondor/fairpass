export interface AuthConfig {
  secret: Uint8Array;
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

const parseTtlSeconds = (value: string | undefined): number => {
  const ttl = Number(value ?? "86400");
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new Error("DEMO_TOKEN_TTL_SECONDS must be a positive integer");
  }
  return ttl;
};

export const loadAuthConfig = (): AuthConfig => {
  const secret = process.env.DEMO_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("DEMO_TOKEN_SECRET must contain at least 32 characters");
  }

  return {
    secret: new TextEncoder().encode(secret),
    ttlSeconds: parseTtlSeconds(process.env.DEMO_TOKEN_TTL_SECONDS),
    issuer: "fairpass-backend",
    audience: "fairpass-demo",
  };
};
