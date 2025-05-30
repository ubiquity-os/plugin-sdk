import { EmitterWebhookEvent as WebhookEvent, EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { CommentHandler } from "./comment";
import { customOctokit } from "./octokit";

export interface Context<TConfig = unknown, TEnv = unknown, TCommand = unknown, TSupportedEvents extends WebhookEventName = WebhookEventName> {
  eventName: TSupportedEvents;
  payload: {
    [K in TSupportedEvents]: K extends WebhookEventName ? WebhookEvent<K> : never;
  }[TSupportedEvents]["payload"];
  command: TCommand | null;
  octokit: InstanceType<typeof customOctokit>;
  config: TConfig;
  env: TEnv;
  logger: Logs;
  commentHandler: CommentHandler;
}
