import { EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { Type as T } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { LogReturn, Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Hono } from "hono";
import { env as honoEnv } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { postComment } from "./comment";
import { Context } from "./context";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { customOctokit } from "./octokit";
import { verifySignature } from "./signature";
import { Manifest } from "./types/manifest";
import { HandlerReturn } from "./types/sdk";
import { getPluginOptions, Options } from "./util";

const inputSchema = T.Object({
  stateId: T.String(),
  eventName: T.String(),
  eventPayload: T.Record(T.String(), T.Any()),
  command: T.Union([T.Null(), T.Object({ name: T.String(), parameters: T.Unknown() })]),
  authToken: T.String(),
  settings: T.Record(T.String(), T.Any()),
  ref: T.String(),
  signature: T.String(),
});

export function createPlugin<TConfig = unknown, TEnv = unknown, TCommand = unknown, TSupportedEvents extends WebhookEventName = WebhookEventName>(
  handler: (context: Context<TConfig, TEnv, TCommand, TSupportedEvents>) => HandlerReturn,
  manifest: Manifest,
  options?: Options
) {
  const pluginOptions = getPluginOptions(options);

  const app = new Hono();

  app.get("/manifest.json", (ctx) => {
    return ctx.json(manifest);
  });

  app.post("/", async (ctx) => {
    if (ctx.req.header("content-type") !== "application/json") {
      throw new HTTPException(400, { message: "Content-Type must be application/json" });
    }

    const body = await ctx.req.json();
    const inputSchemaErrors = [...Value.Errors(inputSchema, body)];
    if (inputSchemaErrors.length) {
      console.log(inputSchemaErrors, { depth: null });
      throw new HTTPException(400, { message: "Invalid body" });
    }
    const inputs = Value.Decode(inputSchema, body);
    const signature = inputs.signature;
    if (!pluginOptions.bypassSignatureVerification && !(await verifySignature(pluginOptions.kernelPublicKey, inputs, signature))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }

    let config: TConfig;
    if (pluginOptions.settingsSchema) {
      try {
        config = Value.Decode(pluginOptions.settingsSchema, Value.Default(pluginOptions.settingsSchema, inputs.settings));
      } catch (e) {
        console.log(...Value.Errors(pluginOptions.settingsSchema, inputs.settings), { depth: null });
        throw e;
      }
    } else {
      config = inputs.settings as TConfig;
    }

    let env: TEnv;
    const honoEnvironment = honoEnv(ctx);
    if (pluginOptions.envSchema) {
      try {
        env = Value.Decode(pluginOptions.envSchema, Value.Default(pluginOptions.envSchema, honoEnvironment));
      } catch (e) {
        console.log(...Value.Errors(pluginOptions.envSchema, honoEnvironment), { depth: null });
        throw e;
      }
    } else {
      env = ctx.env as TEnv;
    }

    const workerName = new URL(inputs.ref).hostname.split(".")[0];
    PluginRuntimeInfo.getInstance({ ...env, CLOUDFLARE_WORKER_NAME: workerName });

    let command: TCommand | null = null;
    if (inputs.command && pluginOptions.commandSchema) {
      try {
        command = Value.Decode(pluginOptions.commandSchema, Value.Default(pluginOptions.commandSchema, inputs.command));
      } catch (e) {
        console.log(...Value.Errors(pluginOptions.commandSchema, inputs.command), { depth: null });
        throw e;
      }
    } else if (inputs.command) {
      command = inputs.command as TCommand;
    }

    const context: Context<TConfig, TEnv, TCommand, TSupportedEvents> = {
      eventName: inputs.eventName as TSupportedEvents,
      payload: inputs.eventPayload,
      command: command,
      octokit: new customOctokit({ auth: inputs.authToken }),
      config: config,
      env: env,
      logger: new Logs(pluginOptions.logLevel),
    };

    try {
      const result = await handler(context);
      return ctx.json({ stateId: inputs.stateId, output: result ?? {} });
    } catch (error) {
      console.error(error);

      let loggerError: LogReturn | Error | null;
      if (error instanceof Error || error instanceof LogReturn) {
        loggerError = error;
      } else {
        loggerError = context.logger.error(`Error: ${error}`);
      }

      if (pluginOptions.postCommentOnError && loggerError) {
        await postComment(context, loggerError);
      }

      throw new HTTPException(500, { message: "Unexpected error" });
    }
  });

  return app;
}
