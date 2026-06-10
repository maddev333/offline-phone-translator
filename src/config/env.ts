import dotenv from "dotenv";
import { envSchema } from "./schema.js";

dotenv.config();

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

if (!env.AZURE_OPENAI_USE_ENTRA_ID && !env.AZURE_OPENAI_API_KEY) {
  throw new Error("AZURE_OPENAI_API_KEY is required when Entra ID is disabled");
}
