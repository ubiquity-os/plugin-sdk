#!/usr/bin/env node

import type { Context } from "../context";
import { callLlm, type LlmCallOptions } from "./index.js";

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const model = getFlagValue(args, "--model") ?? "gpt-5.2-chat-latest";
  const messagesJson = getFlagValue(args, "--messages");
  const messages: LlmCallOptions["messages"] = messagesJson ? (JSON.parse(messagesJson) as LlmCallOptions["messages"]) : [];
  const isStream = getFlagValue(args, "--stream") === "true";

  const authToken = process.env.AUTH_TOKEN;
  const owner = process.env.OWNER;
  const repo = process.env.REPO;

  if (!authToken || !owner || !repo) {
    throw new Error("Missing env vars: AUTH_TOKEN, OWNER, REPO");
  }

  // Mock PluginInput for callLlm
  const mockInput = {
    authToken,
    payload: { repository: { owner: { login: owner }, name: repo } },
  } as unknown as Context;

  const result = await callLlm({ model, messages, stream: isStream }, mockInput);

  if (isStream) {
    if (!isAsyncIterable(result)) {
      throw new Error("Expected a streaming response");
    }
    for await (const chunk of result) {
      console.log(JSON.stringify(chunk));
    }
    return;
  }

  if (isAsyncIterable(result)) {
    throw new Error("Unexpected streaming response");
  }
  console.log(JSON.stringify(result));
}

main().catch(console.error);
