import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { callLlm } from "../src/llm";

const baseInput = {
  authToken: "token",
  eventPayload: {
    repository: { owner: { login: "octo" }, name: "repo" },
    installation: { id: 123 },
  },
};

const encoder = new TextEncoder();

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("callLlm", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("rejects empty messages array", async () => {
    await expect(callLlm({ messages: [] as ChatCompletionMessageParam[] }, baseInput)).rejects.toThrow("messages must be a non-empty array");
  });

  it("parses streamed SSE chunks with mixed line endings", async () => {
    const chunk1: ChatCompletionChunk = {
      id: "chunk-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-5.1",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const chunk2: ChatCompletionChunk = {
      id: "chunk-2",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-5.1",
      choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
    };

    const chunk1Line1 = 'data: {"id":"chunk-1","object":"chat.completion.chunk",';
    const chunk1Line2 = 'data: "created":1,"model":"gpt-5.1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';

    const stream = buildStream([`${chunk1Line1}\r\n${chunk1Line2}\r\n\r\n`, `data:${JSON.stringify(chunk2)}\n\n`, "data: [DONE]\n\n"]);

    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
        },
      })
    );

    const result = await callLlm(
      {
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
        baseUrl: "https://ai.ubq.fi",
      },
      baseInput
    );

    const received: ChatCompletionChunk[] = [];
    for await (const chunk of result as AsyncIterable<ChatCompletionChunk>) {
      received.push(chunk);
    }

    expect(received).toHaveLength(2);
    expect(received[0].id).toBe(chunk1.id);
    expect(received[1].id).toBe(chunk2.id);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.ubq.fi/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "X-GitHub-Owner": "octo",
          "X-GitHub-Repo": "repo",
          "X-GitHub-Installation-Id": "123",
        }),
      })
    );
  });

  it("parses non-streaming responses", async () => {
    const completion = {
      id: "completion-1",
      object: "chat.completion",
      created: 1,
      model: "gpt-5.1",
      choices: [],
    } as ChatCompletion;

    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(completion), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const result = await callLlm({ messages: [{ role: "user", content: "Hi" }], baseUrl: "https://ai.ubq.fi" }, baseInput);

    expect(result).toEqual(completion);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.ubq.fi/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      })
    );
  });

  it("refreshes kernel attestation before calling the LLM for GitHub auth", async () => {
    const completion = {
      id: "completion-2",
      object: "chat.completion",
      created: 1,
      model: "gpt-5.1",
      choices: [],
    } as ChatCompletion;

    const input = {
      authToken: "ghs_initial_token",
      ubiquityKernelToken: "kernel-initial",
      eventPayload: {
        repository: { owner: { login: "octo" }, name: "repo" },
        installation: { id: 123 },
      },
      config: {
        kernelRefreshUrl: "https://kernel.test/internal/agent/refresh-token",
      },
    };

    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "https://kernel.test/internal/agent/refresh-token") {
        return new Response(JSON.stringify({ authToken: "ghs_refreshed", ubiquityKernelToken: "kernel-refreshed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url) === "https://ai.ubq.fi/v1/chat/completions") {
        return new Response(JSON.stringify(completion), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await callLlm({ messages: [{ role: "user", content: "Hi" }], baseUrl: "https://ai.ubq.fi" }, input as typeof baseInput);

    expect(result).toEqual(completion);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://kernel.test/internal/agent/refresh-token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ghs_initial_token",
          "X-Ubiquity-Kernel-Token": "kernel-initial",
          "X-GitHub-Owner": "octo",
          "X-GitHub-Repo": "repo",
          "X-GitHub-Installation-Id": "123",
        }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.ubq.fi/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghs_refreshed",
          "X-Ubiquity-Kernel-Token": "kernel-refreshed",
        }),
      })
    );
  });

  it("throws on API errors", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad request", { status: 400 }));

    await expect(callLlm({ messages: [{ role: "user", content: "Hi" }], baseUrl: "https://ai.ubq.fi" }, baseInput)).rejects.toThrow(
      "LLM API error: 400 - bad request"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on network failures", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const failure = callLlm({ messages: [{ role: "user", content: "Hi" }], baseUrl: "https://ai.ubq.fi" }, baseInput).catch((error) => error);

    await jest.runAllTimersAsync();
    const error = await failure;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("network down");
  });
});
