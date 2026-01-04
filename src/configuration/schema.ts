import { emitterEventNames } from "@octokit/webhooks";
import { StaticDecode, Type as T, TLiteral, Union } from "@sinclair/typebox";

const pluginNameRegex = new RegExp("^([0-9a-zA-Z-._]+)\\/([0-9a-zA-Z-._]+)(?::([0-9a-zA-Z-._]+))?(?:@([0-9a-zA-Z-._]+(?:\\/[0-9a-zA-Z-._]+)*))?$");

export type GithubPlugin = {
  owner: string;
  repo: string;
  workflowId: string;
  ref?: string;
};

/**
 * Parses a plugin identifier string into its constituent parts.
 * @param value - Plugin identifier in format: "owner/repo[:workflowId][@ref]"
 * @returns Parsed plugin information including owner, repo, workflowId (defaults to "compute.yml"), and optional ref
 * @throws Error if the plugin name format is invalid
 * @example parsePluginIdentifier("ubiquity-os/plugin-name") // { owner: "ubiquity-os", repo: "plugin-name", workflowId: "compute.yml" }
 * @example parsePluginIdentifier("ubiquity-os/plugin-name:compute.yml") // { owner: "ubiquity-os", repo: "plugin-name", workflowId: "compute.yml" }
 * @example parsePluginIdentifier("ubiquity-os/plugin-name:custom.yml@v1.0.0") // { owner: "ubiquity-os", repo: "plugin-name", workflowId: "custom.yml", ref: "v1.0.0" }
 */
export function parsePluginIdentifier(value: string): GithubPlugin {
  const matches = pluginNameRegex.exec(value);
  if (!matches) {
    throw new Error(`Invalid plugin name: ${value}`);
  }
  return {
    owner: matches[1],
    repo: matches[2],
    workflowId: matches[3] || "compute.yml",
    ref: matches[4] || undefined,
  };
}

type IntoStringLiteralUnion<T> = { [K in keyof T]: T[K] extends string ? TLiteral<T[K]> : never };

export function stringLiteralUnion<T extends string[]>(values: readonly [...T]): Union<IntoStringLiteralUnion<T>> {
  const literals = values.map((value) => T.Literal(value));
  return T.Union(literals as never);
}

const emitterType = stringLiteralUnion(emitterEventNames);

const runsOnSchema = T.Array(emitterType, { default: [] });

// We accept null when a key has no following body
const pluginSettingsSchema = T.Union(
  [
    T.Null(),
    T.Object(
      {
        with: T.Record(T.String(), T.Unknown(), { default: {} }),
        runsOn: T.Optional(runsOnSchema),
        skipBotEvents: T.Optional(T.Boolean()),
      },
      { default: {} }
    ),
  ],
  { default: null }
);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;

export const configSchema = T.Object(
  {
    imports: T.Optional(T.Array(T.String(), { default: [] })),
    plugins: T.Record(T.String(), pluginSettingsSchema, { default: {} }),
  },
  {
    additionalProperties: true,
  }
);

export type PluginConfiguration = StaticDecode<typeof configSchema>;
