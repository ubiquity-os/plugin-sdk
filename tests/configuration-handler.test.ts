import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Value } from "@sinclair/typebox/value";
import { CONFIG_PROD_FULL_PATH, ConfigurationHandler, LoggerInterface } from "../src/configuration";
import { configSchema, PluginConfiguration } from "../src/configuration/schema";
import { Context } from "../src/context";
import { Manifest } from "../src/types/manifest";

type ConfigFileMap = Record<string, string>;
type ManifestMap = Record<string, Manifest>;

type GetContentParams = {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
};

class TestLogger implements LoggerInterface {
  public entries: Array<{ level: string; message: string; metadata?: Record<string, unknown> }> = [];

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: "debug", message, metadata });
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: "error", message, metadata });
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: "info", message, metadata });
  }

  ok(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: "ok", message, metadata });
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", message, metadata });
  }
}

function notFound(key: string) {
  const error = new Error(`Missing content for ${key}`) as Error & { status: number };
  error.status = 404;
  return error;
}

function createOctokitStub(configFiles: ConfigFileMap, manifests: ManifestMap): Context["octokit"] {
  return {
    rest: {
      repos: {
        getContent: async ({ owner, repo, path, ref }: GetContentParams) => {
          if (path === "manifest.json") {
            const manifestKey = ref ? `${owner}:${repo}:${ref}` : `${owner}:${repo}`;
            const manifest = manifests[manifestKey];
            if (!manifest) {
              throw notFound(manifestKey);
            }
            const content = Buffer.from(JSON.stringify(manifest)).toString("base64");
            return { data: { content } };
          }
          const key = `${owner}:${repo}:${path}`;
          if (!(key in configFiles)) {
            throw notFound(key);
          }
          return { data: configFiles[key], headers: { "x-ratelimit-remaining": "1000" } };
        },
      },
    },
  } as unknown as Context["octokit"];
}

describe("ConfigurationHandler", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it("returns the default configuration when no location is provided", async () => {
    const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub({}, {}));
    const config = await handler.getConfiguration();
    const defaultConfig = Value.Decode(configSchema, Value.Default(configSchema, {}));
    const expected = { ...defaultConfig } as PluginConfiguration & { imports?: string[] };
    delete expected.imports;
    expect(config).toEqual(expected);
  });

  it("defaults workflow IDs to compute.yml when omitted", async () => {
    const owner = "acme";
    const repo = "demo";
    const repoYaml = `plugins:
  "ubiquity-os/example-plugin":
    with:
      level: 1
`;
    const configFiles: ConfigFileMap = {
      [`${owner}:${repo}:${CONFIG_PROD_FULL_PATH}`]: repoYaml,
    };
    const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub(configFiles, {}));
    const config = await handler.getConfiguration({ owner, repo });
    expect(config.plugins["ubiquity-os/example-plugin"]?.with).toEqual({ level: 1 });
    expect(config.plugins["ubiquity-os/example-plugin"]?.skipBotEvents).toBe(true);
  });

  it("loads URL plugin manifests from the endpoint", async () => {
    const owner = "acme";
    const repo = "demo";
    const urlPlugin = "https://example.com/plugin";
    const manifest: Manifest = {
      name: "Example Plugin",
      short_name: "example/plugin@1.0.0",
      description: "Example plugin manifest",
      commands: {},
      "ubiquity:listeners": ["issues.opened"],
      skipBotEvents: false,
    };
    const repoYaml = `plugins:
  "${urlPlugin}":
    with:
      level: 1
`;
    const configFiles: ConfigFileMap = {
      [`${owner}:${repo}:${CONFIG_PROD_FULL_PATH}`]: repoYaml,
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub(configFiles, {}));
    const config = await handler.getConfiguration({ owner, repo });

    expect(config.plugins[urlPlugin]?.with).toEqual({ level: 1 });
    expect(config.plugins[urlPlugin]?.runsOn).toEqual(["issues.opened"]);
    expect(config.plugins[urlPlugin]?.skipBotEvents).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/plugin/manifest.json");
  });

  it("merges organization and repository configs while enriching plugins with manifest defaults", async () => {
    const owner = "acme";
    const repo = "demo";
    const orgYaml = `plugins:
  "ubiquity-os/example-plugin:compute.yml":
    with:
      level: 1
`;
    const repoYaml = `plugins:
  "ubiquity-os/example-plugin:compute.yml":
    with:
      level: 2
  "ubiquity-os/new-plugin:compute.yml":
    with:
      enabled: true
    runsOn:
      - issues.opened
    skipBotEvents: false
`;
    const configFiles: ConfigFileMap = {
      [`${owner}:.ubiquity-os:${CONFIG_PROD_FULL_PATH}`]: orgYaml,
      [`${owner}:${repo}:${CONFIG_PROD_FULL_PATH}`]: repoYaml,
    };
    const manifests: ManifestMap = {
      "ubiquity-os:example-plugin": {
        name: "Example",
        short_name: "ubiquity-os/example-plugin@1.0.0",
        "ubiquity:listeners": ["issues.closed"],
        skipBotEvents: false,
      },
      "ubiquity-os:new-plugin": {
        name: "New",
        short_name: "ubiquity-os/new-plugin@1.0.0",
        "ubiquity:listeners": ["issues.opened"],
        skipBotEvents: true,
      },
    };
    const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub(configFiles, manifests));
    const config = await handler.getConfiguration({ owner, repo });
    expect(Object.keys(config.plugins)).toHaveLength(2);
    expect(config.plugins["ubiquity-os/example-plugin:compute.yml"]?.with).toEqual({ level: 2 });
    expect(config.plugins["ubiquity-os/example-plugin:compute.yml"]?.runsOn).toEqual(["issues.closed"]);
    expect(config.plugins["ubiquity-os/example-plugin:compute.yml"]?.skipBotEvents).toBe(false);
    expect(config.plugins["ubiquity-os/new-plugin:compute.yml"]?.runsOn).toEqual(["issues.opened"]);
    expect(config.plugins["ubiquity-os/new-plugin:compute.yml"]?.skipBotEvents).toBe(false);
  });

  it("returns plugin specific configuration for manifest short names", async () => {
    const staticConfig: PluginConfiguration = {
      plugins: {
        "ubiquity-os/example-plugin:compute.yml": {
          with: { token: "secret" },
          runsOn: [],
          skipBotEvents: true,
        },
      },
    };
    class StaticConfigurationHandler extends ConfigurationHandler {
      constructor(private readonly _staticValue: PluginConfiguration) {
        super(new TestLogger(), createOctokitStub({}, {}));
      }

      public override async getConfiguration(): Promise<PluginConfiguration> {
        return this._staticValue;
      }
    }
    const handler = new StaticConfigurationHandler(staticConfig);
    const manifest: Manifest = {
      name: "Example",
      short_name: "ubiquity-os/example-plugin@1.0.0",
    } as Manifest;
    const otherManifest: Manifest = {
      name: "Other",
      short_name: "ubiquity-os/other-plugin@1.0.0",
    } as Manifest;
    const current = await handler.getSelfConfiguration<{ token: string }>(manifest);
    const missing = await handler.getSelfConfiguration<{ token: string }>(otherManifest);
    expect(current).toEqual({ token: "secret" });
    expect(missing).toBeNull();
  });

  it("resolves imports before merging repository configuration", async () => {
    const owner = "acme";
    const repo = "demo";
    const orgYaml = `imports:
  - acme/shared-config
plugins:
  "ubiquity-os/example-plugin:compute.yml":
    with:
      level: 1
`;
    const orgImportYaml = `plugins:
  "ubiquity-os/example-plugin:compute.yml":
    with:
      level: 3
  "ubiquity-os/extra-plugin:compute.yml":
    with:
      enabled: true
`;
    const repoYaml = `imports:
  - acme/repo-shared
plugins:
  "ubiquity-os/example-plugin:compute.yml":
    with:
      level: 2
`;
    const repoImportYaml = `plugins:
  "ubiquity-os/repo-plugin:compute.yml":
    with:
      flag: true
`;

    const configFiles: ConfigFileMap = {
      [`${owner}:.ubiquity-os:${CONFIG_PROD_FULL_PATH}`]: orgYaml,
      [`${owner}:shared-config:${CONFIG_PROD_FULL_PATH}`]: orgImportYaml,
      [`${owner}:${repo}:${CONFIG_PROD_FULL_PATH}`]: repoYaml,
      [`${owner}:repo-shared:${CONFIG_PROD_FULL_PATH}`]: repoImportYaml,
    };
    const manifests: ManifestMap = {
      "ubiquity-os:example-plugin": {
        name: "Example",
        short_name: "ubiquity-os/example-plugin@1.0.0",
        "ubiquity:listeners": [],
        skipBotEvents: true,
      },
      "ubiquity-os:extra-plugin": {
        name: "Extra",
        short_name: "ubiquity-os/extra-plugin@1.0.0",
        "ubiquity:listeners": [],
        skipBotEvents: true,
      },
      "ubiquity-os:repo-plugin": {
        name: "Repo",
        short_name: "ubiquity-os/repo-plugin@1.0.0",
        "ubiquity:listeners": [],
        skipBotEvents: true,
      },
    };

    const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub(configFiles, manifests));
    const config = await handler.getConfiguration({ owner, repo });

    expect(config.plugins["ubiquity-os/example-plugin:compute.yml"]?.with).toEqual({ level: 2 });
    expect(config.plugins["ubiquity-os/extra-plugin:compute.yml"]?.with).toEqual({ enabled: true });
    expect(config.plugins["ubiquity-os/repo-plugin:compute.yml"]?.with).toEqual({ flag: true });
  });
});
