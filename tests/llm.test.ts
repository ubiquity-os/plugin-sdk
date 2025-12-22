import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions";
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
});
