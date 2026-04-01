import { EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { Value } from "@sinclair/typebox/value";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Hono } from "hono";
import { env as honoEnv } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { CommentHandler } from "./comment";
import { Context } from "./context";
import { transformError } from "./error";
import { getCommand } from "./helpers/command";
import { resolveRuntimeManifest } from "./helpers/runtime-manifest";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { customOctokit } from "./octokit";
import { verifySignature } from "./signature";
import { inputSchema } from "./types/input-schema";
import { Manifest } from "./types/manifest";
import { HandlerReturn } from "./types/sdk";
import { getPluginOptions, Options } from "./util";

type EventHandler<TConfig, TEnv, TCommand, TSupportedEvents extends WebhookEventName> = (
  context: Context<TConfig, TEnv, TCommand, TSupportedEvents>
) => HandlerReturn;

/**
 * Registry for event-based handlers registered via .on().
 * Auto-generates ubiquity:listeners from registered handlers.
 */
class EventHandlerRegistry<TConfig, TEnv, TCommand, TSupportedEvents extends WebhookEventName> {
  private _handlers: Map<TSupportedEvents, EventHandler<TConfig, TEnv, TCommand, TSupportedEvents>> = new Map();

  on<TEvent extends TSupportedEvents>(
    event: TEvent,
    handler: EventHandler<TConfig, TEnv, TCommand, TEvent>
  ): EventHandlerRegistry<TConfig, TEnv, TCommand, TSupportedEvents> {
    this._handlers.set(event as TSupportedEvents, handler as EventHandler<TConfig, TEnv, TCommand, TSupportedEvents>);
    return this;
  }

  getHandler(eventName: string): EventHandler<TConfig, TEnv, TCommand, TSupportedEvents> | undefined {
    return this._handlers.get(eventName as TSupportedEvents);
  }

  getListenerEvents(): TSupportedEvents[] {
    return Array.from(this._handlers.keys());
  }
}

async function handleError(context: Context, pluginOptions: Options, error: unknown) {
  console.error(error);

  const loggerError = transformError(context, error);

  if (pluginOptions.postCommentOnError && loggerError) {
    await context.commentHandler.postComment(context, loggerError);
  }

  throw new HTTPException(500, { message: "Unexpected error" });
}

export function createPlugin<TConfig = unknown, TEnv = unknown, TCommand = unknown, TSupportedEvents extends WebhookEventName = WebhookEventName>(
  handler: (context: Context<TConfig, TEnv, TCommand, TSupportedEvents>) => HandlerReturn,
  manifest: Manifest,
  options?: Options
): Hono & EventHandlerRegistry<TConfig, TEnv, TCommand, TSupportedEvents> {
  const pluginOptions = getPluginOptions(options);
  const registry = new EventHandlerRegistry<TConfig, TEnv, TCommand, TSupportedEvents>();

  const app = new Hono();

  // Merge manifest listeners with registry listeners
  const manifestListeners: TSupportedEvents[] = (manifest["ubiquity:listeners"] as TSupportedEvents[]) ?? [];

  app.get("/manifest.json", (ctx) => {
    const registryListeners = registry.getListenerEvents() as TSupportedEvents[];
    const allListeners = [...new Set([...manifestListeners, ...registryListeners])];
    const mergedManifest: Manifest = {
      ...manifest,
      "ubiquity:listeners": allListeners.length > 0 ? allListeners : undefined,
    };
    return ctx.json(resolveRuntimeManifest(mergedManifest, ctx.req.url));
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

    // Check if there's a registered .on() handler for this event
    const registeredHandler = registry.getHandler(inputs.eventName);
    const activeHandler = registeredHandler ?? handler;

    try {
      const result = await activeHandler(context);
      return ctx.json({ stateId: inputs.stateId, output: result ?? {} });
    } catch (error) {
      await handleError(context, pluginOptions, error);
    }
  });

  // Attach .on() method to the app for fluent event handler registration
  // and return the app as a merged type
  const eventApp = app as Hono & EventHandlerRegistry<TConfig, TEnv, TCommand, TSupportedEvents>;
  (eventApp as unknown as EventHandlerRegistry<TConfig, TEnv, TCommand, TSupportedEvents>).on = registry.on.bind(registry);

  return eventApp;
}
