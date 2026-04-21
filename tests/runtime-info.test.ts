import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

type DenoEnv = {
  get(key: string): string | undefined;
};

class TestDenoRuntimeInfo extends (jest.requireActual("../src/helpers/runtime-info") as typeof import("../src/helpers/runtime-info")).DenoRuntimeInfo {
  public constructor() {
    super();
  }
}

describe("Runtime info tests", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-20T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as { Deno?: { env: DenoEnv } }).Deno;
  });

  it("Should build a Deno console URL with an absolute UTC window", () => {
    (globalThis as { Deno?: { env: DenoEnv } }).Deno = {
      env: {
        get(key: string) {
          switch (key) {
            case "DENO_DEPLOY_ORG_SLUG":
              return "ubiquity-os";
            case "DENO_DEPLOY_APP_SLUG":
              return "ubiquity-os-kernel-development";
            case "DENO_DEPLOYMENT_ID":
              return "deployment-123";
            default:
              return undefined;
          }
        },
      },
    };

    const runtimeInfo = new TestDenoRuntimeInfo();

    expect(runtimeInfo.version).toBe("deployment-123");
    expect(runtimeInfo.runUrl).toBe(
      "https://console.deno.com/ubiquity-os/ubiquity-os-kernel-development/observability/logs?start=2026-04-20T11%3A59%3A00Z&end=2026-04-20T12%3A01%3A00Z&tz=Etc%2FUTC"
    );
  });

  it("Should use visible placeholders when Deno slugs are missing", () => {
    (globalThis as { Deno?: { env: DenoEnv } }).Deno = {
      env: {
        get(key: string) {
          if (key === "DENO_DEPLOYMENT_ID") {
            return "deployment-123";
          }
          return undefined;
        },
      },
    };

    const runtimeInfo = new TestDenoRuntimeInfo();

    expect(runtimeInfo.runUrl).toBe(
      "https://console.deno.com/<missing-deno-org-slug>/<missing-deno-app-slug>/observability/logs?start=2026-04-20T11%3A59%3A00Z&end=2026-04-20T12%3A01%3A00Z&tz=Etc%2FUTC"
    );
  });
});
