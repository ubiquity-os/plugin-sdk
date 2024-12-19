import github from "@actions/github";
import { getRuntimeKey } from "hono/adapter";
import simpleGit from "simple-git";
import { Context } from "../context";

export async function getVersion(context: Context) {
  const env = context.env as Record<string, string>;
  switch (getRuntimeKey()) {
    case "workerd":
      return env.CF_VERSION_METADATA ?? "[missing CF_VERSION_METADATA]";
    case "node":
    case "bun":
      return simpleGit().revparse(["--short", "HEAD"]);
    default:
      return "unknown_version";
  }
}

export function getRunUrl() {
  switch (getRuntimeKey()) {
    case "workerd":
      return "worker url with time";
    case "node":
      return `${github.context.payload.repository?.html_url}/actions/runs/${github.context.runId}`;
    case "bun":
      return "http://localhost";
    default:
      return "unknown_run_url";
  }
}

export async function getPluginName() {
  switch (getRuntimeKey()) {
    case "workerd":
      return "worker url with time";
    case "node":
    case "bun": {
      const currentHash = await simpleGit().revparse(["--short", "HEAD"]);
      const manifest = JSON.parse(await simpleGit().show([`${currentHash}:manifest.json`]));
      return `"${manifest.name}"`;
    }
    default:
      return "unknown_run_url";
  }
}
