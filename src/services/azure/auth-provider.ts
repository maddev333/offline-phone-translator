import { DefaultAzureCredential } from "@azure/identity";
import { env } from "../../config/env.js";
import { logger } from "../../infra/logger.js";

export interface AzureAuthHeaders {
  [key: string]: string;
}

export class AzureAuthProvider {
  private credential = new DefaultAzureCredential();
  private readonly scope = "https://ai.azure.com/.default";

  async getHeaders(): Promise<AzureAuthHeaders> {
    logger.info({
      azureOpenAiEndpoint: env.AZURE_OPENAI_ENDPOINT,
      azureOpenAiDeployment: env.AZURE_OPENAI_DEPLOYMENT,
      azureOpenAiUseEntraId: env.AZURE_OPENAI_USE_ENTRA_ID,
      hasAzureOpenAiApiKey: Boolean(env.AZURE_OPENAI_API_KEY)
    }, "resolving Azure OpenAI auth headers from env");

    if (env.AZURE_OPENAI_USE_ENTRA_ID) {
      try {
        const token = await this.credential.getToken(this.scope);
        if (!token?.token) throw new Error("No Entra token returned");
        logger.info("using Entra ID token for Azure OpenAI auth");
        return { Authorization: `Bearer ${token.token}` };
      } catch (error) {
        logger.warn({ error }, "failed to get Entra ID token for Azure OpenAI auth");
        if (!env.AZURE_OPENAI_API_KEY) {
          throw new Error(`Entra ID auth failed and no API key fallback is configured: ${String(error)}`);
        }
      }
    }

    if (!env.AZURE_OPENAI_API_KEY) {
      throw new Error("API key fallback unavailable");
    }

    logger.info("using API key for Azure OpenAI auth");
    return { "api-key": env.AZURE_OPENAI_API_KEY };
  }
}
