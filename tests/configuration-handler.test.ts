import { describe, expect, it } from "@jest/globals";
import { Value } from "@sinclair/typebox/value";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CONFIG_PROD_FULL_PATH, ConfigurationHandler, LoggerInterface } from "../src/configuration";
import { configSchema, parsePluginIdentifier, PluginConfiguration } from "../src/configuration/schema";
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
  it("returns the default configuration when no location is provided", async () => {
    const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub({}, {}));
    const config = await handler.getConfiguration();
    const defaultConfig = Value.Decode(configSchema, Value.Default(configSchema, {}));
    expect(config).toEqual(defaultConfig);
  });

  it("merges organization and repository configs while enriching plugins with manifest defaults", async () => {
    const owner = "acme";
    const repo = "demo";
    const orgYaml = `plugins:
  "ubiquity-os/example-plugin":
    with:
      level: 1
`;
    const repoYaml = `plugins:
  invalid:
    with:
      should: "skip"
  "ubiquity-os/example-plugin":
    with:
      level: 2
  "ubiquity-os/new-plugin":
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
    expect(config.plugins["ubiquity-os/example-plugin"]?.with).toEqual({ level: 2 });
    expect(config.plugins["ubiquity-os/example-plugin"]?.runsOn).toEqual(["issues.closed"]);
    expect(config.plugins["ubiquity-os/example-plugin"]?.skipBotEvents).toBe(false);
    expect(config.plugins["ubiquity-os/new-plugin"]?.runsOn).toEqual(["issues.opened"]);
    expect(config.plugins["ubiquity-os/new-plugin"]?.skipBotEvents).toBe(false);
    expect(config.plugins.invalid).toBeUndefined();
  });

  it("returns plugin specific configuration for manifest short names", async () => {
    const staticConfig: PluginConfiguration = {
      plugins: {
        "ubiquity-os/example-plugin": {
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

  it("parses URL-based plugin identifiers and rejects invalid identifiers", () => {
    expect(parsePluginIdentifier("https://example.com")).toBe("https://example.com");
    expect(parsePluginIdentifier("http://localhost:8787")).toBe("http://localhost:8787");
    expect(parsePluginIdentifier("ubiquity-os/example-plugin")).toEqual({
      owner: "ubiquity-os",
      repo: "example-plugin",
      workflowId: "compute.yml",
      ref: undefined,
    });
    expect(() => parsePluginIdentifier("ftp://example.com")).toThrow();
    expect(() => parsePluginIdentifier("not a plugin")).toThrow();
  });

  it("fetches and decodes worker manifests from a URL", async () => {
    const expectedManifest: Manifest = {
      name: "Worker Plugin",
      short_name: "acme/worker-plugin@1.0.0",
      "ubiquity:listeners": ["issues.opened"],
      skipBotEvents: true,
    } as Manifest;

    const server = http.createServer((req, res) => {
      if (req.url === "/manifest.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(expectedManifest));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const handler = new ConfigurationHandler(new TestLogger(), createOctokitStub({}, {}));
      const manifest = await handler.getManifest(baseUrl);
      expect(manifest).toEqual(expect.objectContaining({ name: "Worker Plugin", short_name: "acme/worker-plugin@1.0.0" }));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns null when worker manifest fetch fails", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/manifest.json") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("boom");
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const logger = new TestLogger();
      const handler = new ConfigurationHandler(logger, createOctokitStub({}, {}));
      const manifest = await handler.getManifest(baseUrl);
      expect(manifest).toBeNull();
      expect(logger.entries.some((e) => e.level === "error" && e.message.includes("Could not find a manifest for Worker"))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns plugin config by homepage_url (normalized) and supports GitHub keys in same config", async () => {
    const staticConfig: PluginConfiguration = {
      plugins: {
        "https://worker.example.com": { with: { mode: "worker" }, runsOn: [], skipBotEvents: true },
        "ubiquity-os/example-plugin": { with: { mode: "github" }, runsOn: [], skipBotEvents: true },
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

    const byHomepage = await handler.getSelfConfiguration<{ mode: string }>(
      { short_name: "ignored/when-homepage-provided@1.0.0", homepage_url: "https://worker.example.com/" },
      { owner: "acme", repo: "demo" }
    );
    expect(byHomepage).toEqual({ mode: "worker" });

    const byShortName = await handler.getSelfConfiguration<{ mode: string }>({ short_name: "ubiquity-os/example-plugin@1.0.0" });
    expect(byShortName).toEqual({ mode: "github" });
  });
});
