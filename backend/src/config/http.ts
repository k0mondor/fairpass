const DEFAULT_CORS_ORIGIN = "http://127.0.0.1:5173";

export interface HttpConfig {
  corsOrigins: string[];
  jsonBodyLimit: string;
}

const parseCorsOrigins = (value: string | undefined): string[] => {
  const origins = (value ?? DEFAULT_CORS_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : [DEFAULT_CORS_ORIGIN];
};

export const loadHttpConfig = (): HttpConfig => ({
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  jsonBodyLimit: "100kb",
});
