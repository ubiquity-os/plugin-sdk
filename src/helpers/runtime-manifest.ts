import { Manifest } from "../types/manifest";

const EMPTY_VALUE = String();

function readRuntimeTimeline() {
  if (typeof globalThis.Deno !== "undefined" && typeof globalThis.Deno?.env?.get === "function") {
    const denoTimeline = globalThis.Deno.env.get("DENO_TIMELINE");
    if (typeof denoTimeline === "string" && denoTimeline.trim()) {
      return denoTimeline.trim();
    }
  }

  if (typeof process !== "undefined") {
    const processTimeline = process.env.DENO_TIMELINE;
    if (typeof processTimeline === "string" && processTimeline.trim()) {
      return processTimeline.trim();
    }
  }

  return EMPTY_VALUE;
}

function resolveRuntimeRefName(timeline: string) {
  if (!timeline) {
    return EMPTY_VALUE;
  }

  if (timeline === "production") {
    return "main";
  }

  if (timeline.startsWith("git-branch/")) {
    return timeline.slice("git-branch/".length);
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

  return {
    ...manifest,
    short_name: overrideShortName(manifest.short_name, refName),
    homepage_url: new URL(requestUrl).origin,
  };
}
