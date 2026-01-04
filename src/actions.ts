import * as core from "@actions/core";
import { EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
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
import { inputSchema } from "./types/input-schema";
import { HandlerReturn } from "./types/sdk";
import { getPluginOptions, Options } from "./util";

async function handleError(context: Context, pluginOptions: Options, error: unknown) {
  console.error(error);

  const loggerError = transformError(context, error);

  core.setFailed(loggerError.logMessage.diff);

  if (pluginOptions.postCommentOnError && loggerError) {
    await context.commentHandler.postComment(context, loggerError);
  }
}

export async function createActionsPlugin<TConfig = unknown, TEnv = unknown, TCommand = unknown, TSupportedEvents extends WebhookEventName = WebhookEventName>(
  handler: (context: Context<TConfig, TEnv, TCommand, TSupportedEvents>) => HandlerReturn,
  options?: Options
) {
  const pluginOptions = getPluginOptions(options);

  const pluginGithubToken = pluginOptions.returnDataToKernel ? process.env.PLUGIN_GITHUB_TOKEN : undefined;
  if (pluginOptions.returnDataToKernel && !pluginGithubToken) {
    core.setFailed("Error: PLUGIN_GITHUB_TOKEN env is not set");
    return;
  }

  const githubContext = getGithubContext();
  const body = githubContext.payload.inputs;
  const inputSchemaErrors = [...Value.Errors(inputSchema, body)];
  if (inputSchemaErrors.length) {
    console.dir(inputSchemaErrors, { depth: null });
    core.setFailed(`Error: Invalid inputs payload: ${inputSchemaErrors.map((o) => o.message).join(", ")}`);
    return;
  }
  const signature = body.signature;
  if (!pluginOptions.bypassSignatureVerification && !(await verifySignature(pluginOptions.kernelPublicKey, body, signature))) {
    core.setFailed(`Error: Invalid signature`);
    return;
  }
  const inputs = Value.Decode(inputSchema, body);

  let config: TConfig;
  if (pluginOptions.settingsSchema) {
    try {
      config = Value.Decode(pluginOptions.settingsSchema, Value.Default(pluginOptions.settingsSchema, inputs.settings));
    } catch (e) {
      console.dir(...Value.Errors(pluginOptions.settingsSchema, inputs.settings), { depth: null });
      core.setFailed(`Error: Invalid settings provided.`);
      throw e;
    }
  } else {
    config = inputs.settings as TConfig;
  }

  let env: TEnv;
  if (pluginOptions.envSchema) {
    try {
      env = Value.Decode(pluginOptions.envSchema, Value.Default(pluginOptions.envSchema, process.env));
    } catch (e) {
      console.dir(...Value.Errors(pluginOptions.envSchema, process.env), { depth: null });
      core.setFailed(`Error: Invalid environment provided.`);
      throw e;
    }
  } else {
    env = process.env as TEnv;
  }

  const command = getCommand<TCommand>(inputs, pluginOptions);

  const context: Context<TConfig, TEnv, TCommand, TSupportedEvents> = {
    eventName: inputs.eventName as TSupportedEvents,
    payload: inputs.eventPayload,
    command: command,
    authToken: inputs.authToken,
    ubiquityKernelToken: inputs.ubiquityKernelToken,
    octokit: new customOctokit({ auth: inputs.authToken }),
    config: config,
    env: env,
    logger: new Logs(pluginOptions.logLevel),
    commentHandler: new CommentHandler(),
  };

  try {
    const result = await handler(context);
    core.setOutput("result", result);
    if (pluginOptions?.returnDataToKernel) {
      await returnDataToKernel(pluginGithubToken as string, inputs.stateId, result);
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
