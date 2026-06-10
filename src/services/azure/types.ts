export interface AzureRealtimeSessionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface AzureRealtimeSessionConfig {
  type: "realtime";
  model: string;
  instructions?: string;
  audio?: {
    output?: {
      voice?: string;
    };
  };
  tools?: AzureRealtimeSessionTool[];
  tool_choice?: "auto" | "none" | "required";
  turn_detection?: {
    type: "server_vad";
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
}

export interface ClientSecretResponse {
  value: string;
}

export interface NegotiateCallResult {
  sdpAnswer: string;
  location: string | null;
  callId: string | null;
}
