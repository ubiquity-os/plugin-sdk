#!/usr/bin/env node

import { callLlm, type LlmCallOptions } from './index.js';

async function main() {
  const args = process.argv.slice(2);
  let model = 'gpt-5.2-chat-latest';
  let messages: LlmCallOptions['messages'] = [];
  let stream = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (args[i] === '--messages' && args[i + 1]) {
      messages = JSON.parse(args[i + 1]);
      i++;
    } else if (args[i] === '--stream') {
      stream = args[i + 1] === 'true';
      i++;
    }
  }

  const authToken = process.env.AUTH_TOKEN;
  const owner = process.env.OWNER;
  const repo = process.env.REPO;

  if (!authToken || !owner || !repo) {
    throw new Error('Missing env vars: AUTH_TOKEN, OWNER, REPO');
  }

  // Mock PluginInput for callLlm
  const mockInput = {
    authToken,
    payload: { repository: { owner: { login: owner }, name: repo } }
  } as any;

  const result = await callLlm({ model, messages, stream }, mockInput);

  if (stream) {
    for await (const chunk of result as AsyncIterable<any>) {
      console.log(JSON.stringify(chunk));
    }
  } else {
    console.log(JSON.stringify(result));
  }
}

main().catch(console.error);
