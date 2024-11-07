import * as core from "@actions/core";
import * as github from "@actions/github";
import { EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { TAnySchema, Type as T } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { LOG_LEVEL, LogLevel, LogReturn, Logs } from "@ubiquity-os/ubiquity-os-logger";
import { config } from "dotenv";
import { Context } from "./context";
import { customOctokit } from "./octokit";
import { sanitizeMetadata } from "./util";
import { verifySignature } from "./signature";
import { KERNEL_PUBLIC_KEY } from "./constants";

config();

interface Options {
  logLevel?: LogLevel;
  postCommentOnError?: boolean;
  settingsSchema?: TAnySchema;
  envSchema?: TAnySchema;
  kernelPublicKey?: string;
}

const inputSchema = T.Object({
  stateId: T.String(),
  eventName: T.String(),
  eventPayload: T.String(),
  authToken: T.String(),
  settings: T.String(),
  ref: T.String(),
  signature: T.String(),
});

export async function createActionsPlugin<TConfig = unknown, TEnv = unknown, TSupportedEvents extends WebhookEventName = WebhookEventName>(
  handler: (context: Context<TConfig, TEnv, TSupportedEvents>) => Promise<Record<string, unknown> | undefined>,
  options?: Options
) {
  const pluginOptions = {
    logLevel: options?.logLevel || LOG_LEVEL.INFO,
    postCommentOnError: options?.postCommentOnError || true,
    settingsSchema: options?.settingsSchema,
    envSchema: options?.envSchema,
    kernelPublicKey: options?.kernelPublicKey || KERNEL_PUBLIC_KEY,
  };

  const pluginGithubToken = process.env.PLUGIN_GITHUB_TOKEN;
  if (!pluginGithubToken) {
    core.setFailed("Error: PLUGIN_GITHUB_TOKEN env is not set");
    return;
  }

  const inputPayload = github.context.payload.inputs;
  const inputSchemaErrors = [...Value.Errors(inputSchema, inputPayload)];
  if (inputSchemaErrors.length) {
    console.dir(inputSchemaErrors, { depth: null });
    core.setFailed(`Error: Invalid inputs payload: ${inputSchemaErrors.join(",")}`);
    return;
  }
  const inputs = Value.Decode(inputSchema, inputPayload);
  const signature = inputs.signature;
  if (!(await verifySignature(pluginOptions.kernelPublicKey, inputs, signature))) {
    core.setFailed(`Error: Invalid signature`);
    return;
  }

  let config: TConfig;
  if (pluginOptions.settingsSchema) {
    try {
      config = Value.Decode(pluginOptions.settingsSchema, Value.Default(pluginOptions.settingsSchema, JSON.parse(inputs.settings)));
    } catch (e) {
      console.dir(...Value.Errors(pluginOptions.settingsSchema, JSON.parse(inputs.settings)), { depth: null });
      throw e;
    }
  } else {
    config = JSON.parse(inputs.settings) as TConfig;
  }

  let env: TEnv;
  if (pluginOptions.envSchema) {
    try {
      env = Value.Decode(pluginOptions.envSchema, Value.Default(pluginOptions.envSchema, process.env));
    } catch (e) {
      console.dir(...Value.Errors(pluginOptions.envSchema, process.env), { depth: null });
      throw e;
    }
  } else {
    env = process.env as TEnv;
  }

  const context: Context<TConfig, TEnv, TSupportedEvents> = {
    eventName: inputs.eventName as TSupportedEvents,
    payload: JSON.parse(inputs.eventPayload),
    octokit: new customOctokit({ auth: inputs.authToken }),
    config: config,
    env: env,
    logger: new Logs(pluginOptions.logLevel),
  };

  try {
    const result = await handler(context);
    core.setOutput("result", result);
    await returnDataToKernel(pluginGithubToken, inputs.stateId, result);
  } catch (error) {
    console.error(error);

    let loggerError: LogReturn | null;
    if (error instanceof Error) {
      core.setFailed(error);
      loggerError = context.logger.error(`Error: ${error}`, { error: error });
    } else if (error instanceof LogReturn) {
      core.setFailed(error.logMessage.raw);
      loggerError = error;
    } else {
      core.setFailed(`Error: ${error}`);
      loggerError = context.logger.error(`Error: ${error}`);
    }

    if (pluginOptions.postCommentOnError && loggerError) {
      await postErrorComment(context, loggerError);
    }
  }
}

async function postErrorComment(context: Context, error: LogReturn) {
  if ("issue" in context.payload && context.payload.repository?.owner?.login) {
    await context.octokit.rest.issues.createComment({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      issue_number: context.payload.issue.number,
      body: `${error.logMessage.diff}\n<!--\n${getGithubWorkflowRunUrl()}\n${sanitizeMetadata(error.metadata)}\n-->`,
    });
  } else {
    context.logger.info("Cannot post error comment because issue is not found in the payload");
  }
}

function getGithubWorkflowRunUrl() {
  return `${github.context.payload.repository?.html_url}/actions/runs/${github.context.runId}`;
}

async function returnDataToKernel(repoToken: string, stateId: string, output: object | undefined) {
  const octokit = new customOctokit({ auth: repoToken });
  await octokit.rest.repos.createDispatchEvent({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    event_type: "return-data-to-ubiquity-os-kernel",
    client_payload: {
      state_id: stateId,
      output: output ? JSON.stringify(output) : null,
    },
  });
}
