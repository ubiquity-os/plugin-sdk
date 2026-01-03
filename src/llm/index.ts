import type { ChatCompletion, ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Context } from "../context";
import { normalizeBaseUrl } from "../helpers/urls";

type LlmResponseFormat = { type: "json_object" | "text" } | { type: string; [key: string]: unknown };
type LlmPayload = {
  repository?: { owner?: { login?: string }; name?: string };
  installation?: { id?: number };
};

type LlmAuthContext = {
  authToken?: string;
  ubiquityKernelToken?: string;
  payload?: LlmPayload;
  eventPayload?: LlmPayload;
};

export type LlmCallOptions = {
  baseUrl?: string;
  model?: string;
  stream?: boolean;
  messages: ChatCompletionMessageParam[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: LlmResponseFormat;
  stop?: string | string[];
  n?: number;
  logit_bias?: Record<string, number>;
  seed?: number;
  user?: string;
  metadata?: Record<string, unknown>;
  tools?: unknown[];
  tool_choice?: string | Record<string, unknown>;
  [key: string]: unknown;
};

function getEnvString(name: string): string {
  if (typeof process === "undefined" || !process?.env) return "";
  return String(process.env[name] ?? "").trim();
}

function getAiBaseUrl(options: LlmCallOptions): string {
  if (typeof options.baseUrl === "string" && options.baseUrl.trim()) {
    return normalizeBaseUrl(options.baseUrl);
  }

  const envBaseUrl = getEnvString("UBQ_AI_BASE_URL") || getEnvString("UBQ_AI_URL");
  if (envBaseUrl) return normalizeBaseUrl(envBaseUrl);

  return "https://ai.ubq.fi";
}

export async function callLlm(options: LlmCallOptions, input: Context | LlmAuthContext): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
  const inputPayload = input as LlmAuthContext;
  const authToken = inputPayload.authToken;
  const ubiquityKernelToken = inputPayload.ubiquityKernelToken;
  const payload = inputPayload.payload ?? inputPayload.eventPayload;
  const owner = payload?.repository?.owner?.login ?? "";
  const repo = payload?.repository?.name ?? "";
  const installationId = payload?.installation?.id;

  if (!authToken) throw new Error("Missing authToken in inputs");

  const isKernelTokenRequired = authToken.trim().startsWith("gh");
  if (isKernelTokenRequired && !ubiquityKernelToken) {
    throw new Error("Missing ubiquityKernelToken in inputs (kernel attestation is required for GitHub auth)");
  }

  const { baseUrl, model, stream: isStream, messages, ...rest } = options;
  const url = `${getAiBaseUrl({ ...options, baseUrl })}/v1/chat/completions`;
  const body = JSON.stringify({
    ...rest,
    ...(model ? { model } : {}),
    messages,
    stream: isStream ?? false,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  if (owner) headers["X-GitHub-Owner"] = owner;
  if (repo) headers["X-GitHub-Repo"] = repo;
  if (typeof installationId === "number" && Number.isFinite(installationId)) {
    headers["X-GitHub-Installation-Id"] = String(installationId);
  }
  if (ubiquityKernelToken) {
    headers["X-Ubiquity-Kernel-Token"] = ubiquityKernelToken;
  }

  const response = await fetch(url, { method: "POST", headers, body });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${err}`);
  }

  if (isStream) {
    if (!response.body) {
      throw new Error("LLM API error: missing response body for streaming request");
    }
    return parseSseStream(response.body);
  }
  return response.json();
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done: isDone } = await reader.read();
      if (isDone) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        if (event.startsWith("data: ")) {
          const data = event.slice(6);
          if (data === "[DONE]") return;
          yield JSON.parse(data) as ChatCompletionChunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
