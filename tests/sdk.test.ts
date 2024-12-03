import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { EmitterWebhookEventName } from "@octokit/webhooks";
import * as crypto from "crypto";
import { http, HttpResponse } from "msw";
import { KERNEL_PUBLIC_KEY } from "../src/constants";
import { Context } from "../src/context";
import { createPlugin } from "../src/server";
import { signPayload } from "../src/signature";
import { getPluginOptions } from "../src/util";
import { server } from "./__mocks__/node";
import issueCommented from "./__mocks__/requests/issue-comment-post.json";
import { CommandCall } from "../src/types/command";

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

async function getWorkerInputs(
  stateId: string,
  eventName: string,
  eventPayload: object,
  settings: object,
  authToken: string,
  ref: string,
  command: CommandCall | null
) {
  const inputs = {
    stateId,
    eventName,
    eventPayload,
    settings,
    authToken,
    ref,
    command,
  };
  const signature = await signPayload(JSON.stringify(inputs), privateKey);

  return {
    ...inputs,
    signature,
  };
}

async function getWorkflowInputs(
  stateId: string,
  eventName: string,
  eventPayload: object,
  settings: object,
  authToken: string,
  ref: string,
  command: CommandCall | null
) {
  const inputs = {
    stateId,
    eventName,
    eventPayload: JSON.stringify(eventPayload),
    settings: JSON.stringify(settings),
    authToken,
    ref,
    command: JSON.stringify(command),
  };
  const signature = await signPayload(JSON.stringify(inputs), privateKey);

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
      command: context.command,
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
    const inputs = await getWorkerInputs(
      "stateId",
      issueCommentedEvent.eventName,
      issueCommentedEvent.eventPayload,
      { shouldFail: false },
      "test",
      "main",
      null
    );

    const res = await app.request("/", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...inputs, signature: "invalid_signature" }),
      method: "POST",
    });
    expect(res.status).toEqual(400);
  });
  it("Should handle thrown errors", async () => {
    const createComment = jest.fn();
    server.use(
      http.post(
        "https://api.github.com/repos/:owner/:repo/issues/:issue_number/comments",
        async ({ params, request }) => {
          const body = (await request.json()) as { body: string };
          createComment({ ...params, issue_number: Number(params.issue_number), body: body?.body });
          return new HttpResponse();
        },
        { once: true }
      )
    );

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

    const inputs = await getWorkerInputs(
      "stateId",
      issueCommentedEvent.eventName,
      issueCommentedEvent.eventPayload,
      { shouldFail: true },
      "test",
      "main",
      null
    );

    const res = await app.request("/", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(inputs),
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
  "caller": "handler"
}
-->
`,
    });
  });
  it("Should accept correct request", async () => {
    const inputs = await getWorkerInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, { shouldFail: false }, "test", "main", {
      name: "test",
      parameters: { param1: "test" },
    });

    const res = await app.request("/", {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(inputs),
      method: "POST",
    });
    expect(res.status).toEqual(200);
    const result = await res.json();
    expect(result).toEqual({
      stateId: "stateId",
      output: { success: true, event: issueCommented.eventName, command: { name: "test", parameters: { param1: "test" } } },
    });
  });
});

describe("SDK actions tests", () => {
  process.env.PLUGIN_GITHUB_TOKEN = "token";
  const repo = {
    owner: "ubiquity",
    repo: "ubiquity-os-kernel",
  };

  it("Should accept correct request", async () => {
    const githubInputs = await getWorkflowInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, {}, "test_token", "main", {
      name: "test",
      parameters: { param1: "test" },
    });
    jest.unstable_mockModule(githubActionImportPath, () => ({
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
    jest.unstable_mockModule(githubCoreImportPath, () => ({
      setOutput,
      setFailed,
    }));
    const createDispatchEvent = jest.fn();
    jest.unstable_mockModule(sdkOctokitImportPath, () => ({
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
          command: context.command,
        };
      },
      {
        kernelPublicKey: publicKey,
      }
    );
    const expectedResult = { event: issueCommented.eventName, command: { name: "test", parameters: { param1: "test" } } };
    expect(setFailed).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith("result", expectedResult);
    expect(createDispatchEvent).toHaveBeenCalledWith({
      event_type: "return-data-to-ubiquity-os-kernel",
      owner: repo.owner,
      repo: repo.repo,
      client_payload: {
        state_id: "stateId",
        output: JSON.stringify(expectedResult),
      },
    });
  });
  it("Should deny invalid signature", async () => {
    const githubInputs = await getWorkflowInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, {}, "test_token", "main", null);

    jest.unstable_mockModule("@actions/github", () => ({
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
    jest.unstable_mockModule(githubCoreImportPath, () => ({
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
    const githubInputs = await getWorkflowInputs("stateId", issueCommentedEvent.eventName, issueCommentedEvent.eventPayload, {}, "test_token", "main", null);

    jest.unstable_mockModule(githubActionImportPath, () => ({
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
            command: githubInputs.command,
            eventPayload: githubInputs.eventPayload,
          },
        },
        repo: repo,
      },
    }));
    const setOutput = jest.fn();
    const setFailed = jest.fn();
    jest.unstable_mockModule(githubCoreImportPath, () => ({
      setOutput,
      setFailed,
    }));
    const createDispatchEventFn = jest.fn();
    jest.unstable_mockModule(sdkOctokitImportPath, () => ({
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

  it("Should return the proper Kernel Key", () => {
    let options = getPluginOptions({ kernelPublicKey: "" });
    expect(options.kernelPublicKey).toEqual(KERNEL_PUBLIC_KEY);
    options = getPluginOptions({});
    expect(options.kernelPublicKey).toEqual(KERNEL_PUBLIC_KEY);
    options = getPluginOptions({ kernelPublicKey: "1234" });
    expect(options.kernelPublicKey).toEqual("1234");
  });
});
