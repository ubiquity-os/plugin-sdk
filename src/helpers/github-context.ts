import * as github from "@actions/github";

type GithubModule = typeof github & { default?: { context?: typeof github.context } };

export function getGithubContext() {
  const override = (globalThis as { __UOS_GITHUB_CONTEXT__?: typeof github.context }).__UOS_GITHUB_CONTEXT__;
  if (override) {
    return override;
  }
  const module = github as GithubModule;
  const context = module.context ?? module.default?.context;
  if (!context) {
    throw new Error("GitHub context is unavailable.");
  }
  return context;
}
