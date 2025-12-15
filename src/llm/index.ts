import type { Context } from "../context";
import type { PluginInput } from "../signature";
import type { ChatCompletion, ChatCompletionChunk } from "openai/resources/chat/completions";

export type LlmCallOptions = {
  baseUrl?: string;
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  // Extend with other OpenAI params as needed
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

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

export async function callLlm(
  options: LlmCallOptions,
  input: PluginInput | Context
): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
  const authToken = (input as any)?.authToken ?? "";
  const ubiquityKernelToken = (input as any)?.ubiquityKernelToken ?? "";
  const payload = (input as any)?.payload;
  const owner = payload?.repository?.owner?.login ?? "";
  const repo = payload?.repository?.name ?? "";
  const installationId = payload?.installation?.id;

  if (!authToken) throw new Error("Missing authToken in inputs");

  const requiresKernelToken = authToken.trim().startsWith("gh");
  if (requiresKernelToken && !ubiquityKernelToken) {
    throw new Error("Missing ubiquityKernelToken in inputs (kernel attestation is required for GitHub auth)");
  }

  const url = `${getAiBaseUrl(options)}/v1/chat/completions`;
  const body = JSON.stringify({
    model: options.model || "gpt-5.2-chat-latest",
    messages: options.messages,
    stream: options.stream ?? false,
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

  if (options.stream) {
    return parseSseStream(response.body!);
  }
  return response.json();
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        if (event.startsWith("data: ")) {
          const data = event.slice(6);
          if (data === "[DONE]") return;
          yield JSON.parse(data);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
