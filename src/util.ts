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
}

export function sanitizeMetadata(obj: LogReturn["metadata"]): string {
  return JSON.stringify(obj, null, 2).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/--/g, "&#45;&#45;");
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
    bypassSignatureVerification: options?.bypassSignatureVerification || false,
  };
}
