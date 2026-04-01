import { Manifest } from "../types/manifest";

const EMPTY_VALUE = String();
const DENO_BRANCH_SLUG_MAX_LENGTH = 26;

function readRuntimeEnv(key: string) {
  if (typeof globalThis.Deno !== "undefined" && typeof globalThis.Deno?.env?.get === "function") {
    const denoValue = globalThis.Deno.env.get(key);
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

function readRuntimeTimeline() {
  return readRuntimeEnv("DENO_TIMELINE");
}

function readRuntimeRefNames() {
  return [readRuntimeEnv("REF_NAME"), readRuntimeEnv("PLUGIN_MANIFEST_REF_NAME")].filter(Boolean);
}

function isAlphaNumeric(char: string) {
  return /^[a-z0-9]$/.test(char);
}

function normalizeRuntimeBranchSlug(refName: string) {
  const pieces: string[] = [];
  let isPreviousSeparator = true;
  for (const rawChar of refName.trim().toLowerCase()) {
    if (isAlphaNumeric(rawChar)) {
      pieces.push(rawChar);
      isPreviousSeparator = false;
      continue;
    }

    if (!isPreviousSeparator) {
      pieces.push("-");
      isPreviousSeparator = true;
    }
  }

  const normalized = pieces.join(EMPTY_VALUE).replace(/-$/, EMPTY_VALUE);
  const truncated = normalized.slice(0, DENO_BRANCH_SLUG_MAX_LENGTH);
  return truncated.endsWith("-") ? truncated.slice(0, -1) : truncated;
}

function resolveGitBranchRefName(branchSlug: string) {
  if (!branchSlug) {
    return EMPTY_VALUE;
  }

  for (const runtimeRefName of readRuntimeRefNames()) {
    if (normalizeRuntimeBranchSlug(runtimeRefName) === branchSlug) {
      return runtimeRefName;
    }
  }

  return branchSlug;
}

function resolveRuntimeRefName(timeline: string) {
  if (!timeline) {
    return EMPTY_VALUE;
  }

  if (timeline === "production") {
    return "main";
  }

  if (timeline.startsWith("git-branch/")) {
    return resolveGitBranchRefName(timeline.slice("git-branch/".length));
  }

  if (timeline.startsWith("preview/")) {
    return timeline.slice("preview/".length);
  }

  return EMPTY_VALUE;
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

export function resolveRuntimeManifest(manifest: Manifest, requestUrl: string): Manifest {
  const timeline = readRuntimeTimeline();
  const refName = resolveRuntimeRefName(timeline);
  if (!refName) {
    return manifest;
  }

  let homepageUrl: string | undefined;
  try {
    homepageUrl = new URL(requestUrl).origin;
  } catch {
    homepageUrl = undefined;
  }

  return {
    ...manifest,
    short_name: overrideShortName(manifest.short_name, refName),
    ...(homepageUrl ? { homepage_url: homepageUrl } : {}),
  };
}
