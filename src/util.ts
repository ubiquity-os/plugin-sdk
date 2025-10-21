import { TAnySchema } from "@sinclair/typebox";
import { LOG_LEVEL, LogLevel, LogReturn } from "@ubiquity-os/ubiquity-os-logger";
import { KERNEL_PUBLIC_KEY } from "./constants";

export interface Options {
  kernelPublicKey?: string;
  logLevel?: LogLevel;
  postCommentOnError?: boolean;
  settingsSchema?: TAnySchema;
  envSchema?: TAnySchema;
  commandSchema?: TAnySchema;
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

      if (result.endsWith("\r")) {
        result = result.slice(0, -1);
      }
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
