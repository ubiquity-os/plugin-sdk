import { EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { Value } from "@sinclair/typebox/value";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Hono } from "hono";
import { env as honoEnv } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { CommentHandler } from "./comment";
import { Context } from "./context";
import { transformError } from "./error";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { customOctokit } from "./octokit";
import { verifySignature } from "./signature";
import { inputSchema } from "./types/input-schema";
import { Manifest } from "./types/manifest";
import { HandlerReturn } from "./types/sdk";
import { getPluginOptions, Options } from "./util";

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

  app.post("/", async function appPost(ctx) {
    if (ctx.req.header("content-type") !== "application/json") {
      throw new HTTPException(400, { message: "Content-Type must be application/json" });
    }

    const body = await ctx.req.json();
    const inputSchemaErrors = [...Value.Errors(inputSchema, body)];
    if (inputSchemaErrors.length) {
      console.dir(inputSchemaErrors, { depth: null });
      throw new HTTPException(400, { message: "Invalid body" });
    }
    const signature = body.signature;
    if (!pluginOptions.bypassSignatureVerification && !(await verifySignature(pluginOptions.kernelPublicKey, body, signature))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }
    const inputs = Value.Decode(inputSchema, body);

    let config: TConfig;
    if (pluginOptions.settingsSchema) {
      try {
        config = Value.Decode(pluginOptions.settingsSchema, Value.Default(pluginOptions.settingsSchema, inputs.settings));
      } catch (e) {
        console.dir(...Value.Errors(pluginOptions.settingsSchema, inputs.settings), { depth: null });
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
        console.dir(...Value.Errors(pluginOptions.envSchema, honoEnvironment), { depth: null });
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
      commentHandler: new CommentHandler(),
    };

    try {
      const result = await handler(context);
      return ctx.json({ stateId: inputs.stateId, output: result ?? {} });
    } catch (error) {
      console.error(error);

      const loggerError = transformError(context, error);

      if (pluginOptions.postCommentOnError && loggerError) {
        await context.commentHandler.postComment(context, loggerError);
      }

      throw new HTTPException(500, { message: "Unexpected error" });
    }
  });

  return app;
}
