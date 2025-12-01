import { TAnySchema, TSchema } from "@sinclair/typebox";
import { LOG_LEVEL, LogLevel, LogReturn } from "@ubiquity-os/ubiquity-os-logger";
import { KERNEL_PUBLIC_KEY } from "./constants";

export interface Options<TEnvSchema extends TSchema = TAnySchema, TSettingsSchema extends TSchema = TAnySchema, TCommandSchema extends TSchema = TAnySchema> {
  kernelPublicKey?: string;
  logLevel?: LogLevel;
  postCommentOnError?: boolean;
  settingsSchema?: TSettingsSchema;
  envSchema?: TEnvSchema;
  commandSchema?: TCommandSchema;
  /**
   * @deprecated This disables signature verification - only for local development
   */
  bypassSignatureVerification?: boolean;
  /*
   * Should the end of the run trigger a dispatch back to the kernel?
   * Only works for Action runs at the moment.
   */
  returnDataToKernel?: boolean;
}

export function sanitizeMetadata(obj: LogReturn["metadata"]): string {
  return JSON.stringify(obj, null, 2).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/--/g, "&#45;&#45;");
}

/**
 * Removes wrapper backticks or fenced blocks that LLMs often return around payloads.
 */
export function sanitizeLlmResponse(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("```")) {
    let result = trimmed.replace(/^```[a-z0-9+-]*\s*(?:\r\n|\n)?/i, "");

    if (result.endsWith("```")) {
      result = result.slice(0, -3);

      // Remove any trailing newline characters (\r, \n, or both)
      // eslint-disable-next-line sonarjs/slow-regex
      result = result.replace(/[\r\n]+$/, "");
    }

    return result.trim();
  }

  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

export function getPluginOptions(options: Options | undefined) {
  return {
    // Important to use || and not ?? to not consider empty strings
    kernelPublicKey: options?.kernelPublicKey || KERNEL_PUBLIC_KEY,
    logLevel: options?.logLevel || LOG_LEVEL.INFO,
    postCommentOnError: options?.postCommentOnError ?? true,
    settingsSchema: options?.settingsSchema,
    envSchema: options?.envSchema,
    commandSchema: options?.commandSchema,
    // eslint-disable-next-line sonarjs/deprecation
    bypassSignatureVerification: options?.bypassSignatureVerification || false,
    returnDataToKernel: options?.returnDataToKernel ?? true,
  };
}
