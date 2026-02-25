import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),

  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default("jibjib"),
  POSTGRES_USER: z.string().default("jibjib"),
  POSTGRES_PASSWORD: z.string().default(""),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_ACCESS_SECRET: z.string().default("dev-access-secret"),
  JWT_REFRESH_SECRET: z.string().default("dev-refresh-secret"),

  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default(""),
  MINIO_SECRET_KEY: z.string().default(""),
  MINIO_BUCKET: z.string().default("jibjib-media"),

  ONESIGNAL_APP_ID: z.string().default(""),
  ONESIGNAL_API_KEY: z.string().default(""),

  SENTRY_DSN: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  db: {
    host: parsed.data.POSTGRES_HOST,
    port: parsed.data.POSTGRES_PORT,
    database: parsed.data.POSTGRES_DB,
    user: parsed.data.POSTGRES_USER,
    password: parsed.data.POSTGRES_PASSWORD,
  },
  redis: {
    url: parsed.data.REDIS_URL,
  },
  jwt: {
    accessSecret: parsed.data.JWT_ACCESS_SECRET,
    refreshSecret: parsed.data.JWT_REFRESH_SECRET,
  },
  minio: {
    endpoint: parsed.data.MINIO_ENDPOINT,
    port: parsed.data.MINIO_PORT,
    accessKey: parsed.data.MINIO_ACCESS_KEY,
    secretKey: parsed.data.MINIO_SECRET_KEY,
    bucket: parsed.data.MINIO_BUCKET,
  },
  onesignal: {
    appId: parsed.data.ONESIGNAL_APP_ID,
    apiKey: parsed.data.ONESIGNAL_API_KEY,
  },
  sentry: {
    dsn: parsed.data.SENTRY_DSN,
  },
  telegram: {
    botToken: parsed.data.TELEGRAM_BOT_TOKEN,
  },
};
