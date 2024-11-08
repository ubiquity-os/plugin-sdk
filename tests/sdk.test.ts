import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { EmitterWebhookEventName } from "@octokit/webhooks";
import * as crypto from "crypto";
import { Context } from "../src/context";
import { createPlugin } from "../src/server";
import { server } from "./__mocks__/node";
import issueCommented from "./__mocks__/requests/issue-comment-post.json";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

const issueCommentedEvent = {
  eventName: issueCommented.eventName as EmitterWebhookEventName,
  eventPayload: issueCommented.eventPayload,
};

const sdkOctokitImportPath = "../src/octokit";
const githubActionImportPath = "@actions/github";
const githubCoreImportPath = "@actions/core";

async function importRsaPrivateKey(pem: string) {
  const pemContents = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").trim();
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer as ArrayBuffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["sign"]
  );
}

async function signPayload(payload: string) {
  const data = new TextEncoder().encode(payload);
  const pk = await importRsaPrivateKey(privateKey);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pk, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function getWorkerInputs(stateId: string, eventName: string, eventPayload: object, settings: object, authToken: string, ref: string) {
  const inputs = {
    stateId,
    eventName,
    eventPayload,
    settings,
    authToken,
    ref,
  };
  const signature = await signPayload(JSON.stringify(inputs));

  return {
    ...inputs,
    signature,
  };
}

const app = createPlugin(
  async (context: Context<{ shouldFail: boolean }>) => {
    if (context.config.shouldFail) {
      throw context.logger.error("test error");
    }
    return {
      success: true,
      event: context.eventName,
    };
  },
  { name: "test" },
  { kernelPublicKey: publicKey }
);

beforeAll(async () => {
  server.listen();
});

afterEach(() => {
  server.resetHandlers();
  jest.resetModules();
  jest.restoreAllMocks();
});

afterAll(() => server.close());

describe("SDK worker tests", () => {
  it("Should serve manifest", async () => {
    const res = await app.request("/manifest.json", {
      method: "GET",
    });
    expect(res.status).toEqual(200);
    const result = await res.json();
    expect(result).toEqual({ name: "test" });
  });
  it("Should deny POST request with different path", async () => {
    const res = await app.request("/test", {
      method: "POST",
    });
    expect(res.status).toEqual(404);
  });
  it("Should deny POST request without content-type", async () => {
    const res = await app.request("/", {
      method: "POST",
    });
    expect(res.status).toEqual(400);
  });
  it("Should deny POST request with invalid signature", async () => {
    const inputs = getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, { shouldFail: false }, "test", "");

    const res = await app.request("/", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...(await inputs), signature: "invalid_signature" }),
      method: "POST",
    });
    expect(res.status).toEqual(400);
  });
  it("Should handle thrown errors", async () => {
    const createComment = jest.fn();
    jest.mock(sdkOctokitImportPath, () => ({
      customOctokit: class MockOctokit {
        constructor() {
          return {
            rest: {
              issues: {
                createComment,
              },
            },
          };
        }
      },
    }));

    const { createPlugin } = await import("../src/server");
    const app = createPlugin(
      async (context: Context<{ shouldFail: boolean }>) => {
        if (context.config.shouldFail) {
          throw context.logger.error("test error");
        }
        return {
          success: true,
          event: context.eventName,
        };
      },
      { name: "test" },
      { kernelPublicKey: publicKey }
    );

    const inputs = getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, { shouldFail: true }, "test", "");

    const res = await app.request("/", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(await inputs),
      method: "POST",
    });
    expect(res.status).toEqual(500);
    expect(createComment).toHaveBeenCalledWith({
      issue_number: 5,
      owner: "ubiquity-os",
      repo: "bot",
      body: `\`\`\`diff
! test error
\`\`\`

<!-- Ubiquity - undefined -  - undefined
{
  "caller": "error"
}
-->
`,
    });
  });
  it("Should accept correct request", async () => {
    const inputs = getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, { shouldFail: false }, "test", "");

    const res = await app.request("/", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(await inputs),
      method: "POST",
    });
    expect(res.status).toEqual(200);
    const result = await res.json();
    expect(result).toEqual({ stateId: "stateId", output: { success: true, event: issueCommented.eventName } });
  });
});

describe("SDK actions tests", () => {
  process.env.PLUGIN_GITHUB_TOKEN = "token";
  const repo = {
    owner: "ubiquity",
    repo: "ubiquity-os-kernel",
  };

  it("Should accept correct request", async () => {
    const inputs = getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, {}, "test_token", "");
    const githubInputs = await inputs;
    jest.mock(githubActionImportPath, () => ({
      context: {
        runId: "1",
        payload: {
          inputs: githubInputs,
        },
        repo: repo,
      },
    }));
    const setOutput = jest.fn();
    const setFailed = jest.fn();
    jest.mock(githubCoreImportPath, () => ({
      setOutput,
      setFailed,
    }));
    const createDispatchEvent = jest.fn();
    jest.mock(sdkOctokitImportPath, () => ({
      customOctokit: class MockOctokit {
        constructor() {
          return {
            rest: {
              repos: {
                createDispatchEvent: createDispatchEvent,
              },
            },
          };
        }
      },
    }));
    const { createActionsPlugin } = await import("../src/actions");

    await createActionsPlugin(
      async (context: Context) => {
        return {
          event: context.eventName,
        };
      },
      {
        kernelPublicKey: publicKey,
      }
    );
    expect(setFailed).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith("result", { event: issueCommented.eventName });
    expect(createDispatchEvent).toHaveBeenCalledWith({
      event_type: "return-data-to-ubiquity-os-kernel",
      owner: repo.owner,
      repo: repo.repo,
      client_payload: {
        state_id: "stateId",
        output: JSON.stringify({ event: issueCommented.eventName }),
      },
    });
  });
  it("Should deny invalid signature", async () => {
    const inputs = getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, {}, "test_token", "");
    const githubInputs = await inputs;

    jest.mock("@actions/github", () => ({
      context: {
        runId: "1",
        payload: {
          inputs: {
            ...githubInputs,
            signature: "invalid_signature",
          },
        },
        repo: repo,
      },
    }));
    const setOutput = jest.fn();
    const setFailed = jest.fn();
    jest.mock(githubCoreImportPath, () => ({
      setOutput,
      setFailed,
    }));
    const { createActionsPlugin } = await import("../src/actions");

    await createActionsPlugin(
      async (context: Context) => {
        return {
          event: context.eventName,
        };
      },
      {
        kernelPublicKey: publicKey,
      }
    );
    expect(setFailed).toHaveBeenCalledWith("Error: Invalid signature");
    expect(setOutput).not.toHaveBeenCalled();
  });
  it("Should accept inputs in different order", async () => {
    const inputs = getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, {}, "test_token", "");
    const githubInputs = await inputs;

    jest.mock(githubActionImportPath, () => ({
      context: {
        runId: "1",
        payload: {
          inputs: {
            // different order
            signature: githubInputs.signature,
            eventName: githubInputs.eventName,
            settings: githubInputs.settings,
            ref: githubInputs.ref,
            authToken: githubInputs.authToken,
            stateId: githubInputs.stateId,
            eventPayload: githubInputs.eventPayload,
          },
        },
        repo: repo,
      },
    }));
    const setOutput = jest.fn();
    const setFailed = jest.fn();
    jest.mock(githubCoreImportPath, () => ({
      setOutput,
      setFailed,
    }));
    const createDispatchEventFn = jest.fn();
    jest.mock(sdkOctokitImportPath, () => ({
      customOctokit: class MockOctokit {
        constructor() {
          return {
            rest: {
              repos: {
                createDispatchEvent: createDispatchEventFn,
              },
            },
          };
        }
      },
    }));
    const { createActionsPlugin } = await import("../src/actions");

    await createActionsPlugin(
      async (context: Context) => {
        return {
          event: context.eventName,
        };
      },
      {
        kernelPublicKey: publicKey,
      }
    );
    expect(setFailed).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith("result", { event: issueCommentedEvent.eventName });
    expect(createDispatchEventFn).toHaveBeenCalledWith({
      event_type: "return-data-to-ubiquity-os-kernel",
      owner: repo.owner,
      repo: repo.repo,
      client_payload: {
        state_id: "stateId",
        output: JSON.stringify({ event: issueCommentedEvent.eventName }),
      },
    });
  });
});
