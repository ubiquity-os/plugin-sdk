import { TransformDecodeCheckError, Value } from "@sinclair/typebox/value";
import YAML, { YAMLException } from "js-yaml";
import { Buffer } from "node:buffer";
import { configSchema, GithubPlugin, parsePluginIdentifier, PluginConfiguration, PluginSettings } from "./configuration/schema";
import { Context } from "./context";
import { Manifest, manifestSchema } from "./types/manifest";

export const CONFIG_FULL_PATH = ".github/.ubiquity-os.config.yml";
export const DEV_CONFIG_FULL_PATH = ".github/.ubiquity-os.config.dev.yml";
export const CONFIG_ORG_REPO = ".ubiquity-os";

type Location = { owner: string; repo: string };

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ILogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
}

export class ConfigurationHandler {
  private _manifestCache: Record<string, Manifest> = {};

  constructor(private readonly _logger: ILogger) {}

  public async getSelfConfiguration(context: Context, location?: Location) {
    return this.getConfiguration(context, location);
  }

  public async getConfiguration(context: Context, location?: Location) {
    const defaultConfiguration = Value.Decode(configSchema, Value.Default(configSchema, {}));

    if (!location) {
      this._logger.debug("No location was provided, using the default configuration");
      return defaultConfiguration;
    }

    const { owner, repo } = location;
    let mergedConfiguration: PluginConfiguration = defaultConfiguration;

    this._logger.debug("Fetching configurations from the organization and repository", {
      orgRepo: `${repo}/${CONFIG_ORG_REPO}`,
      repo: `${owner}/${repo}`,
    });

    const orgConfig = await this.getConfigurationFromRepo(context, CONFIG_ORG_REPO, owner);
    const repoConfig = await this.getConfigurationFromRepo(context, owner, repo);

    if (orgConfig.config) {
      mergedConfiguration = this.mergeConfigurations(mergedConfiguration, orgConfig.config);
    }
    if (repoConfig.config) {
      mergedConfiguration = this.mergeConfigurations(mergedConfiguration, repoConfig.config);
    }

    const resolvedPlugins: Record<string, PluginSettings> = {};

    this._logger.debug("Found plugins enabled", { repo: `${owner}/${repo}`, plugins: Object.keys(mergedConfiguration.plugins).length });

    for (const [pluginKey, pluginSettings] of Object.entries(mergedConfiguration.plugins)) {
      let pluginIdentifier: string | GithubPlugin;
      try {
        pluginIdentifier = parsePluginIdentifier(pluginKey);
      } catch (error) {
        this._logger.error("Invalid plugin identifier; skipping", { plugin: pluginKey, err: error });
        continue;
      }

      const manifest = await this.getManifest(context, pluginIdentifier);

      let runsOn = pluginSettings?.runsOn ?? [];
      let shouldSkipBotEvents = pluginSettings?.skipBotEvents;

      if (manifest) {
        if (!runsOn.length) {
          runsOn = manifest["ubiquity:listeners"] ?? [];
        }
        if (shouldSkipBotEvents === undefined) {
          shouldSkipBotEvents = manifest.skipBotEvents ?? true;
        }
      }

      resolvedPlugins[pluginKey] = {
        ...pluginSettings,
        with: pluginSettings?.with ?? {},
        runsOn,
        skipBotEvents: shouldSkipBotEvents,
      };
    }
    return {
      ...mergedConfiguration,
      plugins: resolvedPlugins,
    };
  }

  async getConfigurationFromRepo(context: Context, repository: string, owner: string) {
    const rawData = await this.download({
      context,
      repository,
      owner,
    });

    this._logger.debug("Downloaded configuration file", { owner, repository });
    if (!rawData) {
      this._logger.debug("No raw configuration data", { owner, repository });
      return { config: null, errors: null, rawData: null };
    }

    const { yaml, errors } = this.parseYaml(context, rawData);
    const targetRepoConfiguration: PluginConfiguration | null = yaml as PluginConfiguration;
    this._logger.debug("Decoding configuration", { owner, repository });
    if (targetRepoConfiguration) {
      try {
        const configSchemaWithDefaults = Value.Default(configSchema, targetRepoConfiguration) as Readonly<unknown>;
        const errors = Value.Errors(configSchema, configSchemaWithDefaults);
        if (errors.First()) {
          for (const error of errors) {
            this._logger.error("Configuration validation error", { err: error });
          }
        }
        const decodedConfig = Value.Decode(configSchema, configSchemaWithDefaults);
        return { config: decodedConfig, errors, rawData };
      } catch (error) {
        this._logger.error("Error decoding configuration; Will ignore.", { err: error, owner, repository });
        return { config: null, errors: [error instanceof TransformDecodeCheckError ? error.error : error] as YAMLException[], rawData };
      }
    }
    this._logger.error("YAML could not be decoded", { owner, repository, errors });
    return { config: null, errors, rawData };
  }

  async download({ context, repository, owner }: { context: Context; repository: string; owner: string }): Promise<string | null> {
    if (!repository || !owner) {
      this._logger.error("Repo or owner is not defined, cannot download the requested file");
      return null;
    }
    const filePath = context.environment !== "development" ? CONFIG_FULL_PATH : DEV_CONFIG_FULL_PATH;
    try {
      this._logger.debug("Attempting to fetch configuration", { owner, repository, filePath });
      const { data, headers } = await context.octokit.rest.repos.getContent({
        owner,
        repo: repository,
        path: filePath,
        mediaType: { format: "raw" },
      });
      this._logger.debug("Configuration file found", { owner, repository, filePath, rateLimitRemaining: headers?.["x-ratelimit-remaining"], data });
      return data as unknown as string; // this will be a string if media format is raw
    } catch (err) {
      // In case of a missing config, do not log it as an error
      if (err && typeof err === "object" && "status" in err && err.status === 404) {
        this._logger.debug("No configuration file found", { owner, repository, filePath });
      } else {
        this._logger.error("Failed to download the requested file", { err, owner, repository, filePath });
      }
      return null;
    }
  }

  parseYaml(context: Context, data: null | string) {
    this._logger.debug("Will attempt to parse YAML data", { data });
    try {
      if (data) {
        const parsedData = YAML.load(data);
        this._logger.debug("Parsed yaml data", { parsedData });
        return { yaml: parsedData ?? null, errors: null };
      }
    } catch (error) {
      this._logger.error("Error parsing YAML", { error });
      return { errors: [error] as YAMLException[], yaml: null };
    }
    this._logger.debug("Could not parse YAML");
    return { yaml: null, errors: null };
  }

  protected mergeConfigurations(configuration1: PluginConfiguration, configuration2: PluginConfiguration): PluginConfiguration {
    const mergedPlugins = {
      ...configuration1.plugins,
      ...configuration2.plugins,
    };
    return {
      ...configuration1,
      ...configuration2,
      plugins: mergedPlugins,
    };
  }

  public getManifest(context: Context, plugin: string | GithubPlugin) {
    return isGithubPlugin(plugin) ? this.fetchActionManifest(context, plugin) : this.fetchWorkerManifest(context, plugin);
  }

  async fetchActionManifest(context: Context, { owner, repo, ref }: GithubPlugin): Promise<Manifest | null> {
    const manifestKey = ref ? `${owner}:${repo}:${ref}` : `${owner}:${repo}`;
    if (this._manifestCache[manifestKey]) {
      return this._manifestCache[manifestKey];
    }
    try {
      const { data } = await context.octokit.rest.repos.getContent({
        owner,
        repo,
        path: "manifest.json",
        ref,
      });
      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        const contentParsed = JSON.parse(content);
        const manifest = this.decodeManifest(context, contentParsed);
        this._manifestCache[manifestKey] = manifest;
        return manifest;
      }
    } catch (e) {
      this._logger.error("Could not find a manifest for Action", { owner, repo, err: e });
    }
    return null;
  }

  async fetchWorkerManifest(context: Context, url: string): Promise<Manifest | null> {
    if (this._manifestCache[url]) {
      return this._manifestCache[url];
    }
    const manifestUrl = `${url}/manifest.json`;
    try {
      const result = await fetch(manifestUrl);
      const jsonData = await result.json();
      const manifest = this.decodeManifest(context, jsonData);
      this._manifestCache[url] = manifest;
      return manifest;
    } catch (e) {
      this._logger.error("Could not find a manifest for Worker", { manifestUrl, err: e });
    }
    return null;
  }

  decodeManifest(context: Context, manifest: unknown) {
    const errors = [...Value.Errors(manifestSchema, manifest)];
    if (errors.length) {
      for (const error of errors) {
        this._logger.error("Manifest validation error", { error });
      }
      throw new Error("Manifest is invalid.");
    }
    const defaultManifest = Value.Default(manifestSchema, manifest);
    return defaultManifest as Manifest;
  }
}

export function isGithubPlugin(plugin: string | GithubPlugin): plugin is GithubPlugin {
  return typeof plugin !== "string";
}
