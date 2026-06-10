import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1),
  AZURE_OPENAI_USE_ENTRA_ID: z.string().default("true").transform((v) => v === "true"),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  REALTIME_VOICE: z.string().default("alloy"),
  REALTIME_VAD_THRESHOLD: z.coerce.number().default(0.5),
  REALTIME_VAD_PREFIX_PADDING_MS: z.coerce.number().int().default(300),
  REALTIME_VAD_SILENCE_DURATION_MS: z.coerce.number().int().default(500),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_AUDIENCE: z.string().min(1),
  MCP_SERVER_URL: z.string().url().default("https://learn.microsoft.com/api/mcp")
});

export type AppEnv = z.infer<typeof envSchema>;
