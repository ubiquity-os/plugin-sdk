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
      PluginRuntimeInfo._instance = getRuntimeKey() === "workerd" ? new CfRuntimeInfo(env) : new NodeRuntimeInfo(env);
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
