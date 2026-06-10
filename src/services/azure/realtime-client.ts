import { env } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import type { AzureRealtimeSessionConfig, ClientSecretResponse, NegotiateCallResult } from "./types.js";
import { AzureAuthProvider } from "./auth-provider.js";

export class AzureRealtimeClient {
  constructor(private readonly authProvider: AzureAuthProvider) {}

  private baseUrl(): string {
    return env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
  }

  async createClientSecret(session: AzureRealtimeSessionConfig): Promise<ClientSecretResponse> {
    const headers = {
      ...(await this.authProvider.getHeaders()),
      "Content-Type": "application/json"
    };

    const url = `${this.baseUrl()}/openai/v1/realtime/client_secrets`;
    logger.info({
      azureOpenAiEndpoint: this.baseUrl(),
      azureOpenAiDeployment: env.AZURE_OPENAI_DEPLOYMENT,
      azureOpenAiUseEntraId: env.AZURE_OPENAI_USE_ENTRA_ID,
      realtimeVadThreshold: session.turn_detection?.threshold,
      realtimeVadPrefixPaddingMs: session.turn_detection?.prefix_padding_ms,
      realtimeVadSilenceDurationMs: session.turn_detection?.silence_duration_ms,
      url
    }, "creating Azure OpenAI realtime client secret");

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ session })
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`client_secrets failed: ${response.status} ${body}`);
    }

    return JSON.parse(body) as ClientSecretResponse;
  }

  async negotiateCall(ephemeralToken: string, sdpOffer: string): Promise<NegotiateCallResult> {
    const url = `${this.baseUrl()}/openai/v1/realtime/calls`;
    logger.info({
      azureOpenAiEndpoint: this.baseUrl(),
      url
    }, "negotiating Azure OpenAI realtime call");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ephemeralToken}`,
        "Content-Type": "application/sdp"
      },
      body: sdpOffer
    });

    const sdpAnswer = await response.text();
    if (!response.ok && response.status !== 201) {
      throw new Error(`realtime calls failed: ${response.status} ${sdpAnswer}`);
    }

    const location = response.headers.get("Location");
    const callId = location?.split("/").pop() ?? null;

    return { sdpAnswer, location, callId };
  }
}
