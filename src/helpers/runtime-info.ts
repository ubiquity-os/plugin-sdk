import github from "@actions/github";
import { getRuntimeKey } from "hono/adapter";

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
          PluginRuntimeInfo._instance = new DenoRuntimeInfo(env);
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

  public abstract get version(): Promise<string>;
  public abstract get runUrl(): string;
}

export class CfRuntimeInfo extends PluginRuntimeInfo {
  public get version(): Promise<string> {
    // See also https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/
    return Promise.resolve((this._env.CLOUDFLARE_VERSION_METADATA as { id: string })?.id ?? "CLOUDFLARE_VERSION_METADATA");
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
    return Promise.resolve(github.context.sha);
  }
  public get runUrl() {
    return github.context.payload.repository ? `${github.context.payload.repository?.html_url}/actions/runs/${github.context.runId}` : "http://localhost";
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
    return Promise.resolve(Deno.env.get("DENO_DEPLOYMENT_ID"));
  }
  public get runUrl() {
    const projectName = Deno.env.get("DENO_PROJECT_NAME");
    const baseUrl = `https://dash.deno.com/project/${projectName}/logs`;
    const start = new Date(Date.now() - 60000).toISOString();
    const end = new Date(Date.now() + 60000).toISOString();
    const filters = {
      query: "",
      timeRangeOption: "custom",
      recentValue: "1hour",
      customValues: {
        start,
        end,
      },
      logLevels: {
        debug: true,
        info: true,
        warning: true,
        error: true,
      },
      regions: {
        "gcp-asia-southeast1": true,
        "gcp-europe-west2": true,
        "gcp-europe-west3": true,
        "gcp-southamerica-east1": true,
        "gcp-us-east4": true,
        "gcp-us-west2": true,
      },
    };
    const filtersParam = encodeURIComponent(JSON.stringify(filters));
    return `${baseUrl}?filters=${filtersParam}`;
  }
}
