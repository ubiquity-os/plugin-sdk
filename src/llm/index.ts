import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { Context } from "../context";
import type { PluginInput } from "../signature";

// eslint-disable-next-line @ubiquity-os/no-empty-strings
const EMPTY_STRING = "";

export type LlmCallOptions = {
  baseUrl?: string;
  model?: string;
  stream?: boolean;
  messages: ChatCompletionMessageParam[];
} & Partial<Omit<ChatCompletionCreateParamsNonStreaming, "model" | "messages" | "stream">>;

function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

const MAX_LLM_RETRIES = 2;
const RETRY_BACKOFF_MS = [250, 750];

function getRetryDelayMs(attempt: number): number {
  return RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ?? 750;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnvString(name: string): string {
  if (typeof process === "undefined" || !process?.env) return EMPTY_STRING;
  return String(process.env[name] ?? EMPTY_STRING).trim();
}

function getAiBaseUrl(options: LlmCallOptions): string {
  if (typeof options.baseUrl === "string" && options.baseUrl.trim()) {
    return normalizeBaseUrl(options.baseUrl);
  }

  const envBaseUrl = getEnvString("UOS_AI_URL") || getEnvString("UOS_AI_BASE_URL");
  if (envBaseUrl) return normalizeBaseUrl(envBaseUrl);

  return "https://ai-ubq-fi.deno.dev";
}

export async function callLlm(options: LlmCallOptions, input: PluginInput | Context): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
  const authToken = String(input.authToken ?? EMPTY_STRING).trim();
  if (!authToken) {
    const err = new Error("Missing authToken in input");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }

  const kernelToken = "ubiquityKernelToken" in input ? input.ubiquityKernelToken : undefined;
  const payload = getPayload(input);
  const { owner, repo, installationId } = getRepoMetadata(payload);
  ensureKernelToken(authToken, kernelToken);

  const { baseUrl, model, stream: isStream, messages, ...rest } = options;
  ensureMessages(messages);
  const url = buildAiUrl(options, baseUrl);
  const body = JSON.stringify({
    ...rest,
    ...(model ? { model } : {}),
    messages,
    stream: isStream ?? false,
  });

  const headers = buildHeaders(authToken, {
    owner,
    repo,
    installationId,
    ubiquityKernelToken: kernelToken,
  });

  const response = await fetchWithRetry(url, { method: "POST", headers, body }, MAX_LLM_RETRIES);

  if (isStream) {
    if (!response.body) {
      throw new Error("LLM API error: missing response body for streaming request");
    }
    return parseSseStream(response.body);
  }
  return response.json();
}

function ensureKernelToken(authToken: string, kernelToken?: string) {
  const isKernelTokenRequired = authToken.startsWith("gh");
  if (isKernelTokenRequired && !kernelToken) {
    const err = new Error("Missing ubiquityKernelToken in input (kernel attestation is required for GitHub auth)");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
}

function ensureMessages(messages: ChatCompletionMessageParam[]) {
  if (!Array.isArray(messages) || messages.length === 0) {
    const err = new Error("messages must be a non-empty array");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
}

function buildAiUrl(options: LlmCallOptions, baseUrl?: string): string {
  return `${getAiBaseUrl({ ...options, baseUrl })}/v1/chat/completions`;
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries: number): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      const errText = await response.text();
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(getRetryDelayMs(attempt));
        attempt += 1;
        continue;
      }
      const error = new Error(`LLM API error: ${response.status} - ${errText}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    } catch (error) {
      lastError = error;
      const status = typeof (error as { status?: number }).status === "number" ? (error as { status?: number }).status : undefined;
      if (typeof status === "number" && status < 500) {
        throw error;
      }
      if (attempt >= maxRetries) throw error;
      await sleep(getRetryDelayMs(attempt));
      attempt += 1;
    }
  }
  throw lastError ?? new Error("LLM API error: request failed after retries");
}

function getPayload(input: PluginInput | Context): unknown {
  if ("payload" in input) {
    return (input as Context).payload;
  }
  return (input as PluginInput).eventPayload;
}

function getRepoMetadata(payload: unknown): { owner: string; repo: string; installationId?: number } {
  const repoPayload = payload as {
    repository?: { owner?: { login?: string }; name?: string };
    installation?: { id?: number };
  };
  return {
    owner: repoPayload?.repository?.owner?.login ?? EMPTY_STRING,
    repo: repoPayload?.repository?.name ?? EMPTY_STRING,
    installationId: repoPayload?.installation?.id,
  };
}

function buildHeaders(
  authToken: string,
  options: { owner: string; repo: string; installationId?: number; ubiquityKernelToken?: string }
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  if (options.owner) headers["X-GitHub-Owner"] = options.owner;
  if (options.repo) headers["X-GitHub-Repo"] = options.repo;
  if (typeof options.installationId === "number" && Number.isFinite(options.installationId)) {
    headers["X-GitHub-Installation-Id"] = String(options.installationId);
  }
  if (options.ubiquityKernelToken) {
    headers["X-Ubiquity-Kernel-Token"] = options.ubiquityKernelToken;
  }

  return headers;
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = EMPTY_STRING;
  try {
    while (true) {
      const { value, done: isDone } = await reader.read();
      if (isDone) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = splitSseEvents(buffer);
      buffer = remainder;
      for (const event of events) {
        const data = getEventData(event);
        if (!data) continue;
        if (data.trim() === "[DONE]") return;
        yield parseEventData(data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function splitSseEvents(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() ?? EMPTY_STRING;
  return { events: parts, remainder };
}

function getEventData(event: string): string | null {
  if (!event.trim()) return null;
  const dataLines = event.split("\n").filter((line) => line.startsWith("data:"));
  if (!dataLines.length) return null;
  const data = dataLines.map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5).replace(/^ /, EMPTY_STRING))).join("\n");
  return data || null;
}

function parseEventData(data: string): ChatCompletionChunk {
  try {
    return JSON.parse(data) as ChatCompletionChunk;
  } catch (error) {
    if (data.includes("\n")) {
      const collapsed = data.replace(/\n/g, EMPTY_STRING);
      try {
        return JSON.parse(collapsed) as ChatCompletionChunk;
      } catch {
        // fall through to the original error
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const preview = data.length > 200 ? `${data.slice(0, 200)}...` : data;
    throw new Error(`LLM stream parse error: ${message}. Data: ${preview}`);
  }
}
