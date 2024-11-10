import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/index.ts"],
  project: ["src/**/*.ts"],
  ignore: ["**/__mocks__/**", "**/__fixtures__/**"],
  ignoreExportsUsedInFile: true,
  // eslint can also be safely ignored as per the docs: https://knip.dev/guides/handling-issues#eslint--jest
  // ts-node is used by jest
  ignoreDependencies: ["eslint-config-prettier", "eslint-plugin-prettier", "@mswjs/data", "ts-node"],
  eslint: true,
  // Knip doesn't recognize 'bun publish'
  ignoreBinaries: ["publish"],
};

export default config;
