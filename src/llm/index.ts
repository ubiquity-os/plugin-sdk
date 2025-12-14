import type { PluginInput } from '../plugin-sdk/src/signature';
import type { Context } from '../plugin-sdk/src/context';
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';

export type LlmCallOptions = {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  // Extend with other OpenAI params as needed
};

export async function callLlm(
  options: LlmCallOptions,
  input: PluginInput | Context
): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
  // Extract authToken and repo details
  const authToken = 'authToken' in input ? input.authToken : (input as any).eventHandler?.getToken ? await (input as any).eventHandler.getToken((input as any).payload.installation.id) : '';
  const payload = (input as any).payload;
  const owner = payload?.repository?.owner?.login || '';
  const repo = payload?.repository?.name || '';

  if (!authToken) throw new Error('Missing authToken in inputs');

  const url = 'https://ai.ubq.fi/v1/chat/completions';
  const body = JSON.stringify({
    model: options.model || 'gpt-5.2-chat-latest',
    messages: options.messages,
    stream: options.stream ?? false,
  });

  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'X-GitHub-Owner': owner,
    'X-GitHub-Repo': repo,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { method: 'POST', headers, body });
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
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        if (event.startsWith('data: ')) {
          const data = event.slice(6);
          if (data === '[DONE]') return;
          yield JSON.parse(data);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
