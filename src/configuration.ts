import { TransformDecodeCheckError, Value } from "@sinclair/typebox/value";
import YAML, { YAMLException } from "js-yaml";
import { Buffer } from "node:buffer";
import { configSchema, GithubPlugin, parsePluginIdentifier, PluginConfiguration, PluginSettings } from "./configuration/schema";
import { Context } from "./context";
import { normalizeBaseUrl } from "./helpers/urls";
import { Manifest, manifestSchema } from "./types/manifest";

export const CONFIG_PROD_FULL_PATH = ".github/.ubiquity-os.config.yml";
export const CONFIG_DEV_FULL_PATH = ".github/.ubiquity-os.config.dev.yml";
export const CONFIG_ORG_REPO = ".ubiquity-os";
// eslint-disable-next-line @ubiquity-os/no-empty-strings
const EMPTY_STRING = "";

type Location = { owner: string; repo: string };
type OctokitFactory = (location: Location) => Promise<Context["octokit"] | null>;
type ImportState = {
  cache: Map<string, PluginConfiguration | null>;
  inFlight: Set<string>;
  octokitByLocation: Map<string, Context["octokit"] | null>;
};

const ENVIRONMENT_TO_CONFIG_SUFFIX: Record<string, string> = {
  development: "dev",
};

const VALID_CONFIG_SUFFIX = /^[a-z0-9][a-z0-9_-]*$/i;
const MAX_IMPORT_DEPTH = 6;

function normalizeEnvironmentName(environment: string | null | undefined): string {
  return String(environment ?? EMPTY_STRING)
    .trim()
    .toLowerCase();
}

function getConfigPathCandidatesForEnvironment(environment: string | null | undefined): string[] {
  const normalized = normalizeEnvironmentName(environment);
  if (!normalized) {
    return [CONFIG_PROD_FULL_PATH, CONFIG_DEV_FULL_PATH];
  }
  if (normalized === "production" || normalized === "prod") {
    return [CONFIG_PROD_FULL_PATH];
  }
  const suffix = ENVIRONMENT_TO_CONFIG_SUFFIX[normalized] ?? normalized;
  if (suffix === "dev") {
    return [CONFIG_DEV_FULL_PATH];
  }
  if (!VALID_CONFIG_SUFFIX.test(suffix)) {
    return [CONFIG_DEV_FULL_PATH];
  }
  return [`.github/.ubiquity-os.config.${suffix}.yml`, CONFIG_PROD_FULL_PATH];
}

function normalizeImportKey(location: Location): string {
  return `${location.owner}`.trim().toLowerCase() + "/" + `${location.repo}`.trim().toLowerCase();
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function resolveManifestUrl(pluginUrl: string): string | null {
  try {
    const parsed = new URL(pluginUrl.trim());
    let pathname = parsed.pathname;
    while (pathname.endsWith("/") && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    if (pathname.endsWith(".json")) {
      parsed.search = EMPTY_STRING;
      parsed.hash = EMPTY_STRING;
      return parsed.toString();
    }
    parsed.pathname = `${pathname}/manifest.json`;
    parsed.search = EMPTY_STRING;
    parsed.hash = EMPTY_STRING;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseImportSpec(value: string): Location | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}

function readImports(logger: LoggerInterface, value: unknown, source: Location): Location[] {
  if (!value) return [];
  if (!Array.isArray(value)) {
    logger.warn("Invalid imports; expected a list of strings.", { source });
    return [];
  }
  const seen = new Set<string>();
  const imports: Location[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      logger.warn("Ignoring invalid import entry; expected string.", { source, entry });
      continue;
    }
    const parsed = parseImportSpec(entry);
    if (!parsed) {
      logger.warn("Ignoring invalid import entry; expected owner/repo.", { source, entry });
      continue;
    }
    const key = normalizeImportKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push(parsed);
  }
  return imports;
}

function stripImports(config: PluginConfiguration): PluginConfiguration {
  if (!config || typeof config !== "object") return config;
  const rest = { ...(config as PluginConfiguration) } as PluginConfiguration & { imports?: unknown };
  delete rest.imports;
  return rest as PluginConfiguration;
}

function mergeImportedConfigs(imported: PluginConfiguration[], base: PluginConfiguration | null): PluginConfiguration | null {
  if (!imported.length) {
    return base;
  }
  let merged = imported[0];
  for (let i = 1; i < imported.length; i++) {
    merged = {
      ...merged,
      ...imported[i],
      plugins: { ...merged.plugins, ...imported[i].plugins },
    };
  }
  return base
    ? {
        ...merged,
        ...base,
        plugins: { ...merged.plugins, ...base.plugins },
      }
    : merged;
}

export interface LoggerInterface {
  debug(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  ok?(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
}

function logOk(logger: LoggerInterface, message: string, metadata?: Record<string, unknown>) {
  if (logger.ok) {
    logger.ok(message, metadata);
  } else {
    logger.info(message, metadata);
  }
}

export function isGithubPlugin(plugin: string | GithubPlugin): plugin is GithubPlugin {
  return typeof plugin !== "string";
}

/**
 * Handles fetching and managing plugin configurations from GitHub repositories.
 * Prioritizes production configuration (`.ubiquity-os.config.yml`) over development configuration (`.ubiquity-os.config.dev.yml`),
 * except if the `_environment` value is provided to the constructor.
 **/
export class ConfigurationHandler {
  private _manifestCache: Record<string, Manifest> = {};
  private _manifestPromiseCache: Partial<Record<string, Promise<Manifest | null>>> = {};
  private readonly _octokitFactory?: OctokitFactory;

  constructor(
    private readonly _logger: LoggerInterface,
    private readonly _octokit: Context["octokit"],
    private readonly _environment: string | null = null,
    options?: { octokitFactory?: OctokitFactory }
  ) {
    this._octokitFactory = options?.octokitFactory;
  }

  /**
   *  Retrieves the configuration for the current plugin based on its manifest.
   *  @param manifest - The plugin manifest containing the `short_name` identifier
   *  @param location - Optional repository location (`owner/repo`)
   *  @returns The plugin's configuration or null if not found
   **/
  public async getSelfConfiguration<T extends NonNullable<PluginSettings>["with"]>(
    manifest: Pick<Manifest, "short_name" | "homepage_url">,
    location?: Location
  ): Promise<T | null> {
    const cfg = await this.getConfiguration(location);
    let selfConfig: string | undefined;
    if (manifest.homepage_url) {
      const name = manifest.homepage_url;
      selfConfig = Object.keys(cfg.plugins).find((key) => normalizeBaseUrl(key) === normalizeBaseUrl(name));
    } else {
      const name = manifest.short_name.split("@")[0];
      selfConfig = Object.keys(cfg.plugins).find((key) => new RegExp(`^${name}(?:$|@.+)`).exec(key.replace(/:[^@]+/, "")));
    }
    return selfConfig && cfg.plugins[selfConfig] ? (cfg.plugins[selfConfig]?.["with"] as T) : null;
  }

  /**
   * Retrieves and merges configuration from organization and repository levels.
   * @param location - Optional repository location (`owner` and `repo`). If not provided, returns the default configuration.
   * @returns The merged plugin configuration with resolved plugin settings.
   */
  public async getConfiguration(location?: Location) {
    const defaultConfiguration = stripImports(Value.Decode(configSchema, Value.Default(configSchema, {})));

    if (!location) {
      this._logger.info("No location was provided, using the default configuration");
      return defaultConfiguration;
    }

    const mergedConfiguration = await this._getMergedConfiguration(location, defaultConfiguration);
    const resolvedPlugins = await this._resolvePlugins(mergedConfiguration, location);
    return {
      ...mergedConfiguration,
      plugins: resolvedPlugins,
    };
  }

  private async _getMergedConfiguration(location: Location, defaultConfiguration: PluginConfiguration): Promise<PluginConfiguration> {
    const { owner, repo } = location;
    let mergedConfiguration = defaultConfiguration;

    this._logger.info("Fetching configurations from the organization and repository", {
      orgRepo: `${owner}/${CONFIG_ORG_REPO}`,
      repo: `${owner}/${repo}`,
    });

    const orgConfig = await this.getConfigurationFromRepo(owner, CONFIG_ORG_REPO);
    const repoConfig = await this.getConfigurationFromRepo(owner, repo);

    if (orgConfig.config) {
      mergedConfiguration = this.mergeConfigurations(mergedConfiguration, orgConfig.config);
    }
    if (repoConfig.config) {
      mergedConfiguration = this.mergeConfigurations(mergedConfiguration, repoConfig.config);
    }

    return mergedConfiguration;
  }

  private async _resolvePlugins(mergedConfiguration: PluginConfiguration, location: Location): Promise<Record<string, PluginSettings>> {
    const resolvedPlugins: Record<string, PluginSettings> = {};
    logOk(this._logger, "Found plugins enabled", { repo: `${location.owner}/${location.repo}`, plugins: Object.keys(mergedConfiguration.plugins).length });

    for (const [pluginKey, pluginSettings] of Object.entries(mergedConfiguration.plugins)) {
      const resolved = await this._resolvePluginSettings(pluginKey, pluginSettings);
      if (!resolved) continue;
      resolvedPlugins[pluginKey] = resolved;
    }

    return resolvedPlugins;
  }

  private async _resolvePluginSettings(pluginKey: string, pluginSettings?: PluginSettings): Promise<PluginSettings | null> {
    const isUrlPlugin = isHttpUrl(pluginKey);
    let manifest: Manifest | null = null;
    if (!isUrlPlugin) {
      let pluginIdentifier: GithubPlugin | string;
      try {
        pluginIdentifier = parsePluginIdentifier(pluginKey);
      } catch (error) {
        this._logger.warn("Invalid plugin identifier; skipping", { plugin: pluginKey, err: error });
        return null;
      }
      manifest = await this.getManifest(pluginIdentifier);
    } else {
      manifest = await this._fetchUrlManifest(pluginKey);
    }

    let runsOn = pluginSettings?.runsOn ?? [];
    let shouldSkipBotEvents = pluginSettings?.skipBotEvents;

    if (manifest) {
      if (!runsOn.length) {
        runsOn = manifest["ubiquity:listeners"] ?? [];
      }
      if (shouldSkipBotEvents === undefined) {
        shouldSkipBotEvents = manifest.skipBotEvents ?? true;
      }
    } else {
      shouldSkipBotEvents = true;
    }

    return {
      ...pluginSettings,
      with: pluginSettings?.with ?? {},
      runsOn,
      skipBotEvents: shouldSkipBotEvents,
    };
  }

  /**
   * Retrieves the configuration from the given owner/repository. Also returns the raw data and errors, if any.
   *
   * @param owner The repository owner
   * @param repository The repository name
   */
  public async getConfigurationFromRepo(owner: string, repository: string) {
    const location = { owner, repo: repository };
    const state = this._createImportState();
    const octokit = await this._getOctokitForLocation(location, state);
    if (!octokit) {
      this._logger.warn("No Octokit available for configuration load", { owner, repository });
      return { config: null, errors: null, rawData: null };
    }

    const { config, imports, errors, rawData } = await this._loadConfigSource(location, octokit);
    if (!rawData) {
      return { config: null, errors: null, rawData: null };
    }
    if (errors && errors.length) {
      this._logger.warn("YAML could not be decoded", { owner, repository, errors });
      return { config: null, errors, rawData };
    }
    if (!config) {
      this._logger.warn("YAML could not be decoded", { owner, repository });
      return { config: null, errors, rawData };
    }

    const importedConfigs: PluginConfiguration[] = [];
    for (const next of imports) {
      const resolved = await this._resolveImportedConfiguration(next, state, 1);
      if (resolved) importedConfigs.push(resolved);
    }

    const mergedConfig = mergeImportedConfigs(importedConfigs, config);
    if (!mergedConfig) {
      return { config: null, errors: null, rawData };
    }

    const decoded = this._decodeConfiguration(location, mergedConfig);
    return { config: decoded.config, errors: decoded.errors, rawData };
  }

  private _createImportState(): ImportState {
    return {
      cache: new Map(),
      inFlight: new Set(),
      octokitByLocation: new Map(),
    };
  }

  private async _getOctokitForLocation(location: Location, state: ImportState): Promise<Context["octokit"] | null> {
    const key = normalizeImportKey(location);
    if (state.octokitByLocation.has(key)) {
      return state.octokitByLocation.get(key) ?? null;
    }
    if (this._octokitFactory) {
      const resolved = await this._octokitFactory(location);
      if (resolved) {
        state.octokitByLocation.set(key, resolved);
        return resolved;
      }
    }
    state.octokitByLocation.set(key, this._octokit);
    return this._octokit;
  }

  private async _loadConfigSource(location: Location, octokit: Context["octokit"]) {
    const rawData = await this._download({
      repository: location.repo,
      owner: location.owner,
      octokit,
    });
    if (!rawData) {
      this._logger.warn("No raw configuration data", { owner: location.owner, repository: location.repo });
      return { config: null, imports: [] as Location[], errors: null, rawData: null };
    }
    logOk(this._logger, "Downloaded configuration file", { owner: location.owner, repository: location.repo });

    const { yaml, errors } = this.parseYaml(rawData);
    const imports = readImports(this._logger, (yaml as { imports?: unknown })?.imports, location);
    if (yaml && typeof yaml === "object" && !Array.isArray(yaml) && "imports" in (yaml as { imports?: unknown })) {
      delete (yaml as { imports?: unknown }).imports;
    }
    const targetRepoConfiguration: PluginConfiguration | null = yaml as PluginConfiguration;
    return { config: targetRepoConfiguration, imports, errors, rawData };
  }

  private _decodeConfiguration(location: Location, config: PluginConfiguration) {
    this._logger.info("Decoding configuration", { owner: location.owner, repository: location.repo });
    try {
      const configSchemaWithDefaults = Value.Default(configSchema, config) as Readonly<unknown>;
      const errors = Value.Errors(configSchema, configSchemaWithDefaults);
      if (errors.First()) {
        for (const error of errors) {
          this._logger.warn("Configuration validation error", { err: error });
        }
      }
      const decodedConfig = Value.Decode(configSchema, configSchemaWithDefaults);
      return { config: stripImports(decodedConfig), errors: errors.First() ? errors : null };
    } catch (error) {
      this._logger.warn("Error decoding configuration; Will ignore.", { err: error, owner: location.owner, repository: location.repo });
      return { config: null, errors: [error instanceof TransformDecodeCheckError ? error.error : error] as YAMLException[] };
    }
  }

  private async _resolveImportedConfiguration(location: Location, state: ImportState, depth: number): Promise<PluginConfiguration | null> {
    const key = normalizeImportKey(location);
    if (state.cache.has(key)) {
      return state.cache.get(key) ?? null;
    }
    if (state.inFlight.has(key)) {
      this._logger.warn("Skipping import due to circular reference.", { location });
      return null;
    }
    if (depth > MAX_IMPORT_DEPTH) {
      this._logger.warn("Skipping import; maximum depth exceeded.", { location, depth });
      return null;
    }
    state.inFlight.add(key);

    let resolved: PluginConfiguration | null = null;
    try {
      const octokit = await this._getOctokitForLocation(location, state);
      if (!octokit) {
        this._logger.warn("Skipping import; no authorized Octokit for owner.", { location });
        return null;
      }
      const { config, imports, errors } = await this._loadConfigSource(location, octokit);
      if (errors && errors.length) {
        this._logger.warn("Skipping import due to YAML parsing errors.", { location, errors });
        return null;
      }
      if (!config) {
        return null;
      }
      const importedConfigs: PluginConfiguration[] = [];
      for (const next of imports) {
        const nested = await this._resolveImportedConfiguration(next, state, depth + 1);
        if (nested) importedConfigs.push(nested);
      }
      const mergedConfig = mergeImportedConfigs(importedConfigs, config);
      if (!mergedConfig) return null;
      const decoded = this._decodeConfiguration(location, mergedConfig);
      resolved = decoded.config;
    } finally {
      state.inFlight.delete(key);
      state.cache.set(key, resolved);
    }

    return resolved;
  }

  private async _download({ repository, owner, octokit }: { repository: string; owner: string; octokit: Context["octokit"] }): Promise<string | null> {
    if (!repository || !owner) {
      this._logger.warn("Repo or owner is not defined, cannot download the requested file");
      return null;
    }
    const pathList = getConfigPathCandidatesForEnvironment(this._environment);
    for (const filePath of pathList) {
      const content = await this._tryDownloadPath({ repository, owner, octokit, filePath });
      if (content !== null) return content;
    }
    return null;
  }

  private async _tryDownloadPath({
    repository,
    owner,
    octokit,
    filePath,
  }: {
    repository: string;
    owner: string;
    octokit: Context["octokit"];
    filePath: string;
  }): Promise<string | null> {
    try {
      this._logger.info("Attempting to fetch configuration", { owner, repository, filePath });
      const { data, headers } = await octokit.rest.repos.getContent({
        owner,
        repo: repository,
        path: filePath,
        mediaType: { format: "raw" },
      });
      logOk(this._logger, "Configuration file found", { owner, repository, filePath, rateLimitRemaining: headers?.["x-ratelimit-remaining"] });
      return data as unknown as string; // this will be a string if media format is raw
    } catch (err) {
      this._handleDownloadError(err, { owner, repository, filePath });
      return null;
    }
  }

  private _handleDownloadError(err: unknown, context: { owner: string; repository: string; filePath: string }): void {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) : null;
    if (status === 404) {
      this._logger.warn("No configuration file found", context);
      return;
    }
    const metadata = { err, ...context, ...(status ? { status } : {}) };
    if (status && status >= 500) {
      this._logger.error("Failed to download the requested file", metadata);
    } else {
      this._logger.warn("Failed to download the requested file", metadata);
    }
  }

  /*
   * Parse the raw YAML content and returns the loaded YAML, or errors if any.
   */
  public parseYaml(data: null | string) {
    this._logger.info("Will attempt to parse YAML data");
    try {
      if (data) {
        const parsedData = YAML.load(data);
        logOk(this._logger, "Parsed yaml data successfully");
        return { yaml: parsedData ?? null, errors: null };
      }
    } catch (error) {
      this._logger.warn("Error parsing YAML", { error });
      return { errors: [error] as YAMLException[], yaml: null };
    }
    this._logger.warn("Could not parse YAML");
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

  public getManifest(plugin: GithubPlugin | string) {
    return isGithubPlugin(plugin) ? this._fetchActionManifest(plugin) : this._fetchWorkerManifest(plugin);
  }

  private async _fetchWorkerManifest(url: string): Promise<Manifest | null> {
    if (this._manifestCache[url]) {
      return this._manifestCache[url];
    }
    const manifestUrl = `${url}/manifest.json`;
    try {
      const result = await fetch(manifestUrl);
      if (!result.ok) {
        this._logger.error("Could not find a manifest for Worker", { manifestUrl, status: result.status });
        return null;
      }
      const jsonData = await result.json();
      const manifest = this._decodeManifest(jsonData);
      this._manifestCache[url] = manifest;
      return manifest;
    } catch (e) {
      this._logger.error("Could not find a manifest for Worker", { manifestUrl, err: e });
    }
    return null;
  }

  private async _fetchUrlManifest(pluginUrl: string): Promise<Manifest | null> {
    const manifestUrl = resolveManifestUrl(pluginUrl);
    if (!manifestUrl) {
      this._logger.warn("Invalid plugin URL; cannot fetch manifest", { pluginUrl });
      return null;
    }
    const manifestKey = `url:${manifestUrl}`;
    if (this._manifestCache[manifestKey]) {
      return this._manifestCache[manifestKey];
    }
    if (this._manifestPromiseCache[manifestKey]) {
      return this._manifestPromiseCache[manifestKey];
    }
    const manifestPromise = (async () => {
      if (typeof fetch !== "function") {
        this._logger.warn("Fetch is unavailable; cannot load URL manifest", { manifestUrl });
        return null;
      }
      try {
        const response = await fetch(manifestUrl);
        if (!response.ok) {
          this._logger.warn("URL manifest request failed", { manifestUrl, status: response.status });
          return null;
        }
        const data = await response.json();
        const manifest = this._decodeManifest(data);
        this._manifestCache[manifestKey] = manifest;
        return manifest;
      } catch (e) {
        this._logger.warn("Could not load URL manifest", { manifestUrl, err: e });
        return null;
      }
    })();
    this._manifestPromiseCache[manifestKey] = manifestPromise;
    try {
      return await manifestPromise;
    } finally {
      delete this._manifestPromiseCache[manifestKey];
    }
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
        this._logger.warn("Could not find a valid manifest", { owner, repo, err: e });
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
        this._logger.warn("Manifest validation error", { error });
      }
      throw new Error("Manifest is invalid.");
    }
    const defaultManifest = Value.Default(manifestSchema, manifest);
    return defaultManifest as Manifest;
  }
}
