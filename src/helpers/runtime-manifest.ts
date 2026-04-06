import type { Manifest } from "../types/manifest";

const EMPTY_VALUE = String();
const GITHUB_HEADS_PREFIX = "refs/heads/";
const GITHUB_TAGS_PREFIX = "refs/tags/";

type RuntimeManifestEnv = Record<string, unknown>;
type GlobalRuntime = typeof globalThis & {
  Deno?: {
    env?: {
      get?: (key: string) => string | undefined;
    };
  };
};

function readRuntimeEnvValue(env: RuntimeManifestEnv | undefined, key: string) {
  const explicitValue = env?.[key];
  if (typeof explicitValue === "string" && explicitValue.trim()) {
    return explicitValue.trim();
  }

  const runtime = globalThis as GlobalRuntime;
  if (typeof runtime.Deno?.env?.get === "function") {
    const denoValue = runtime.Deno.env.get(key);
    if (typeof denoValue === "string" && denoValue.trim()) {
      return denoValue.trim();
    }
  }

  if (typeof process !== "undefined") {
    const processValue = process.env[key];
    if (typeof processValue === "string" && processValue.trim()) {
      return processValue.trim();
    }
  }

  return EMPTY_VALUE;
}

function parseRefNameFromGitHubRef(ref: string) {
  if (!ref) {
    return EMPTY_VALUE;
  }

  if (ref.startsWith(GITHUB_HEADS_PREFIX)) {
    return ref.slice(GITHUB_HEADS_PREFIX.length);
  }

  if (ref.startsWith(GITHUB_TAGS_PREFIX)) {
    return ref.slice(GITHUB_TAGS_PREFIX.length);
  }

  return ref;
}

function overrideShortName(shortName: string, refName: string) {
  if (!shortName || !refName) {
    return shortName;
  }

  const separatorIndex = shortName.lastIndexOf("@");
  const repository = separatorIndex === -1 ? shortName : shortName.slice(0, separatorIndex);
  if (!repository) {
    return shortName;
  }

  return `${repository}@${refName}`;
}

function resolveRuntimeRefName(env?: RuntimeManifestEnv) {
  const explicitRefName = readRuntimeEnvValue(env, "REF_NAME");
  if (explicitRefName) {
    return explicitRefName;
  }

  const legacyManifestRefName = readRuntimeEnvValue(env, "PLUGIN_MANIFEST_REF_NAME");
  if (legacyManifestRefName) {
    return legacyManifestRefName;
  }

  const githubRefName = readRuntimeEnvValue(env, "GITHUB_REF_NAME");
  if (githubRefName) {
    return githubRefName;
  }

  return parseRefNameFromGitHubRef(readRuntimeEnvValue(env, "GITHUB_REF"));
}

export function resolveRuntimeManifest(manifest: Manifest, env?: RuntimeManifestEnv): Manifest {
  const refName = resolveRuntimeRefName(env);
  if (!refName) {
    return manifest;
  }

  return {
    ...manifest,
    short_name: overrideShortName(manifest.short_name, refName),
  };
}
