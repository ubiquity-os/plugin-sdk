import { TransformDecodeCheckError, Value } from "@sinclair/typebox/value";
import YAML, { YAMLException } from "js-yaml";
import { Buffer } from "node:buffer";
import { configSchema, GithubPlugin, parsePluginIdentifier, PluginConfiguration, PluginSettings } from "./configuration/schema";
import { Context } from "./context";
import { Manifest, manifestSchema } from "./types/manifest";

export const CONFIG_PROD_FULL_PATH = ".github/.ubiquity-os.config.yml";
export const CONFIG_DEV_FULL_PATH = ".github/.ubiquity-os.config.dev.yml";
export const CONFIG_ORG_REPO = ".ubiquity-os";

type Location = { owner: string; repo: string };

export interface LoggerInterface {
  debug(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * Handles fetching and managing plugin configurations from GitHub repositories.
 * Prioritizes production configuration (`.ubiquity-os.config.yml`) over development configuration (`.ubiquity-os.config.dev.yml`).
 **/
export class ConfigurationHandler {
  private _manifestCache: Record<string, Manifest> = {};
  private _manifestPromiseCache: Partial<Record<string, Promise<Manifest | null>>> = {};

  constructor(
    private readonly _logger: LoggerInterface,
    private readonly _octokit: Context["octokit"]
  ) {}

  /**
   *  Retrieves the configuration for the current plugin based on its manifest.
   *  @param manifest - The plugin manifest containing the `short_name` identifier
   *  @param location - Optional repository location (`owner/repo`)
   *  @returns The plugin's configuration or null if not found
   **/
  public async getSelfConfiguration<T extends NonNullable<PluginSettings>["with"]>(manifest: Manifest, location?: Location): Promise<T | null> {
    const cfg = await this.getConfiguration(location);
    const name = manifest.short_name.split("@")[0].replaceAll("/", "\\/");
    const selfConfig = Object.keys(cfg.plugins).find((key) => RegExp(new RegExp(`^${name}(?:$|@.+)`)).exec(key));
    return selfConfig && cfg.plugins[selfConfig] ? (cfg.plugins[selfConfig]["with"] as T) : null;
  }

  /*
   * Gets the configuration for the given location, if provided. If not found or if no location is given, returns the
   * default configuration instead.
   */
  public async getConfiguration(location?: Location) {
    const defaultConfiguration = Value.Decode(configSchema, Value.Default(configSchema, {}));

    if (!location) {
      this._logger.debug("No location was provided, using the default configuration");
      return defaultConfiguration;
    }

    const { owner, repo } = location;
    let mergedConfiguration: PluginConfiguration = defaultConfiguration;

    this._logger.debug("Fetching configurations from the organization and repository", {
      orgRepo: `${owner}/${CONFIG_ORG_REPO}`,
      repo: `${owner}/${repo}`,
    });

    const orgConfig = await this._getConfigurationFromRepo(owner, CONFIG_ORG_REPO);
    const repoConfig = await this._getConfigurationFromRepo(owner, repo);

    if (orgConfig.config) {
      mergedConfiguration = this.mergeConfigurations(mergedConfiguration, orgConfig.config);
    }
    if (repoConfig.config) {
      mergedConfiguration = this.mergeConfigurations(mergedConfiguration, repoConfig.config);
    }

    const resolvedPlugins: Record<string, PluginSettings> = {};

    this._logger.debug("Found plugins enabled", { repo: `${owner}/${repo}`, plugins: Object.keys(mergedConfiguration.plugins).length });

    for (const [pluginKey, pluginSettings] of Object.entries(mergedConfiguration.plugins)) {
      let pluginIdentifier: GithubPlugin;
      try {
        pluginIdentifier = parsePluginIdentifier(pluginKey);
      } catch (error) {
        this._logger.error("Invalid plugin identifier; skipping", { plugin: pluginKey, err: error });
        continue;
      }

      const manifest = await this.getManifest(pluginIdentifier);

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

  private async _getConfigurationFromRepo(owner: string, repository: string) {
    const rawData = await this._download({
      repository,
      owner,
    });

    this._logger.debug("Downloaded configuration file", { owner, repository });
    if (!rawData) {
      this._logger.debug("No raw configuration data", { owner, repository });
      return { config: null, errors: null, rawData: null };
    }

    const { yaml, errors } = this._parseYaml(rawData);
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

  private async _download({ repository, owner }: { repository: string; owner: string }): Promise<string | null> {
    if (!repository || !owner) {
      this._logger.error("Repo or owner is not defined, cannot download the requested file");
      return null;
    }
    const pathList = [CONFIG_PROD_FULL_PATH, CONFIG_DEV_FULL_PATH];
    for (const filePath of pathList) {
      try {
        this._logger.debug("Attempting to fetch configuration", { owner, repository, filePath });
        const { data, headers } = await this._octokit.rest.repos.getContent({
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
          this._logger.warn("No configuration file found", { owner, repository, filePath });
        } else {
          this._logger.error("Failed to download the requested file", { err, owner, repository, filePath });
        }
      }
    }
    return null;
  }

  private _parseYaml(data: null | string) {
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

  public getManifest(plugin: GithubPlugin) {
    return this._fetchActionManifest(plugin);
  }

  private async _fetchActionManifest({ owner, repo, ref }: GithubPlugin): Promise<Manifest | null> {
    const manifestKey = ref ? `${owner}:${repo}:${ref}` : `${owner}:${repo}`;
    if (this._manifestCache[manifestKey]) {
      return this._manifestCache[manifestKey];
    }
    if (this._manifestPromiseCache[manifestKey]) {
      return this._manifestPromiseCache[manifestKey];
    }
    const manifestPromise = (async () => {
      try {
        const { data } = await this._octokit.rest.repos.getContent({
          owner,
          repo,
          path: "manifest.json",
          ref,
        });
        if ("content" in data) {
          const content = Buffer.from(data.content, "base64").toString();
          const contentParsed = JSON.parse(content);
          const manifest = this._decodeManifest(contentParsed);
          this._manifestCache[manifestKey] = manifest;
          return manifest;
        }
      } catch (e) {
        this._logger.error("Could not find a valid manifest", { owner, repo, err: e });
      }
      return null;
    })();
    this._manifestPromiseCache[manifestKey] = manifestPromise;
    try {
      return await manifestPromise;
    } finally {
      delete this._manifestPromiseCache[manifestKey];
    }
  }

  private _decodeManifest(manifest: unknown) {
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
