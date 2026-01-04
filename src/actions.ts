import * as core from "@actions/core";
import { EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { CommentHandler } from "./comment";
import { Context } from "./context";
import { transformError } from "./error";
import { getCommand } from "./helpers/command";
import { compressString } from "./helpers/compression";
import { getGithubContext } from "./helpers/github-context";
import { customOctokit } from "./octokit";
import { verifySignature } from "./signature";
import { inputSchema, type InputSchema } from "./types/input-schema";
import { HandlerReturn } from "./types/sdk";
import { getPluginOptions, Options } from "./util";

type PluginOptions = ReturnType<typeof getPluginOptions>;

async function handleError(context: Context, pluginOptions: PluginOptions, error: unknown) {
  console.error(error);

  const loggerError = transformError(context, error);

  core.setFailed(loggerError.logMessage.diff);

  if (pluginOptions.postCommentOnError && loggerError) {
    await context.commentHandler.postComment(context, loggerError);
  }
}

function getDispatchTokenOrFail(pluginOptions: PluginOptions): string | null {
  if (!pluginOptions.returnDataToKernel) return null;
  const token = process.env.PLUGIN_GITHUB_TOKEN;
  if (!token) {
    core.setFailed("Error: PLUGIN_GITHUB_TOKEN env is not set");
    return null;
  }
  return token;
}

async function getInputsOrFail(pluginOptions: PluginOptions): Promise<InputSchema | null> {
  const githubContext = getGithubContext();
  const body = githubContext.payload.inputs;
  const inputSchemaErrors = [...Value.Errors(inputSchema, body)];
  if (inputSchemaErrors.length) {
    console.dir(inputSchemaErrors, { depth: null });
    core.setFailed(`Error: Invalid inputs payload: ${inputSchemaErrors.map((o) => o.message).join(", ")}`);
    return null;
  }

  if (!pluginOptions.bypassSignatureVerification) {
    const signature = typeof body.signature === "string" ? body.signature : "";
    if (!signature) {
      core.setFailed("Error: Missing signature");
      return null;
    }
    const isValid = await verifySignature(pluginOptions.kernelPublicKey, body, signature);
    if (!isValid) {
      core.setFailed("Error: Invalid signature");
      return null;
    }
  }

  return Value.Decode(inputSchema, body);
}

type DecodeResult<T> = { value: T | null; error?: Error };

function decodeWithSchema<T>(schema: TSchema | undefined, value: unknown, errorMessage: string): DecodeResult<T> {
  if (!schema) {
    return { value: value as T };
  }
  try {
    return { value: Value.Decode(schema, Value.Default(schema, value)) };
  } catch (error) {
    console.dir(...Value.Errors(schema, value), { depth: null });
    const err = new Error(errorMessage);
    (err as Error & { cause?: unknown }).cause = error;
    return { value: null, error: err };
  }
}

export async function createActionsPlugin<TConfig = unknown, TEnv = unknown, TCommand = unknown, TSupportedEvents extends WebhookEventName = WebhookEventName>(
  handler: (context: Context<TConfig, TEnv, TCommand, TSupportedEvents>) => HandlerReturn,
  options?: Options
) {
  const pluginOptions = getPluginOptions(options);

  const pluginGithubToken = getDispatchTokenOrFail(pluginOptions);
  if (pluginOptions.returnDataToKernel && !pluginGithubToken) {
    return;
  }

  const inputs = await getInputsOrFail(pluginOptions);
  if (!inputs) {
    return;
  }

  const context: Context<TConfig, TEnv, TCommand, TSupportedEvents> = {
    eventName: inputs.eventName as TSupportedEvents,
    payload: inputs.eventPayload,
    command: null,
    authToken: inputs.authToken,
    ubiquityKernelToken: inputs.ubiquityKernelToken,
    octokit: new customOctokit({ auth: inputs.authToken }),
    config: inputs.settings as TConfig,
    env: process.env as TEnv,
    logger: new Logs(pluginOptions.logLevel),
    commentHandler: new CommentHandler(),
  };

  const configResult = decodeWithSchema<TConfig>(pluginOptions.settingsSchema, inputs.settings, "Error: Invalid settings provided.");
  if (!configResult.value) {
    await handleError(context, pluginOptions, configResult.error ?? new Error("Error: Invalid settings provided."));
    return;
  }
  context.config = configResult.value;

  const envResult = decodeWithSchema<TEnv>(pluginOptions.envSchema, process.env, "Error: Invalid environment provided.");
  if (!envResult.value) {
    await handleError(context, pluginOptions, envResult.error ?? new Error("Error: Invalid environment provided."));
    return;
  }
  context.env = envResult.value;

  try {
    context.command = getCommand<TCommand>(inputs, pluginOptions);
    const result = await handler(context);
    core.setOutput("result", result);
    if (pluginOptions.returnDataToKernel && pluginGithubToken) {
      await returnDataToKernel(pluginGithubToken, inputs.stateId, result);
    }
  } catch (error) {
    await handleError(context, pluginOptions, error);
  }
}

async function returnDataToKernel(repoToken: string, stateId: string, output: HandlerReturn) {
  const githubContext = getGithubContext();
  const octokit = new customOctokit({ auth: repoToken });
  await octokit.rest.repos.createDispatchEvent({
    owner: githubContext.repo.owner,
    repo: githubContext.repo.repo,
    event_type: "return-data-to-ubiquity-os-kernel",
    client_payload: {
      state_id: stateId,
      output: output ? compressString(JSON.stringify(output)) : null,
    },
  });
}
