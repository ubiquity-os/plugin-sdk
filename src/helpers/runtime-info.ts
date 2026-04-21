import { getRuntimeKey } from "hono/adapter";
import { getGithubContext } from "./github-context";

function formatUtcTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export abstract class PluginRuntimeInfo {
  private static _instance: PluginRuntimeInfo | null = null;
  protected _env: Record<string, unknown> = {};

  protected constructor(env?: Record<string, string>) {
    if (env) {
      this._env = env;
    }
  }

  public static getInstance(env?: Record<string, string>) {
    if (!PluginRuntimeInfo._instance) {
      switch (getRuntimeKey()) {
        case "workerd":
          PluginRuntimeInfo._instance = new CfRuntimeInfo(env);
          break;
        case "deno":
          // Even if we are in Deno, we need to use the Node runtime within GitHub Actions because it does not actually
          // run within Deno. CI should be a good indicator of the Action environment being used.
          // https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables
          if (process.env.CI) {
            PluginRuntimeInfo._instance = new NodeRuntimeInfo(env);
          } else {
            PluginRuntimeInfo._instance = new DenoRuntimeInfo(env);
          }
          break;
        case "node":
          PluginRuntimeInfo._instance = new NodeRuntimeInfo(env);
          break;
        default:
          PluginRuntimeInfo._instance = new NodeRuntimeInfo(env);
          break;
      }
    }
    return PluginRuntimeInfo._instance;
  }

  public abstract get version(): string;
  public abstract get runUrl(): string;
}

export class CfRuntimeInfo extends PluginRuntimeInfo {
  public get version(): string {
    // See also https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/
    return (this._env.CLOUDFLARE_VERSION_METADATA as { id: string })?.id ?? "CLOUDFLARE_VERSION_METADATA";
  }
  public get runUrl(): string {
    const accountId = this._env.CLOUDFLARE_ACCOUNT_ID ?? "<missing-cloudflare-account-id>";
    const workerName = this._env.CLOUDFLARE_WORKER_NAME;
    const toTime = Date.now() + 60000;
    const fromTime = Date.now() - 60000;
    const timeParam = encodeURIComponent(`{"type":"absolute","to":${toTime},"from":${fromTime}}`);
    return `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production/observability/logs?granularity=0&time=${timeParam}`;
  }
}

export class NodeRuntimeInfo extends PluginRuntimeInfo {
  public get version() {
    return getGithubContext().sha;
  }
  public get runUrl() {
    const context = getGithubContext();
    return context.payload.repository ? `${context.payload.repository?.html_url}/actions/runs/${context.runId}` : "http://localhost";
  }
}

// Deno won't necessarily be here, which is why we forward declare it
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const Deno: {
  env: {
    get(key: string): string;
  };
};

export class DenoRuntimeInfo extends PluginRuntimeInfo {
  public get version() {
    return Deno.env.get("DENO_DEPLOYMENT_ID");
  }
  public get runUrl() {
    const orgSlug = Deno.env.get("DENO_DEPLOY_ORG_SLUG") || "<missing-deno-org-slug>";
    const appSlug = Deno.env.get("DENO_DEPLOY_APP_SLUG") || "<missing-deno-app-slug>";
    const baseUrl = `https://console.deno.com/${orgSlug}/${appSlug}/observability/logs`;
    const searchParams = new URLSearchParams();

    searchParams.set("start", formatUtcTimestamp(Date.now() - 60000));
    searchParams.set("end", formatUtcTimestamp(Date.now() + 60000));
    searchParams.set("tz", "Etc/UTC");

    return `${baseUrl}?${searchParams.toString()}`;
  }
}
