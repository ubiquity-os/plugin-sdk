import { LogReturn } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "./context";

type ErrorWithStatus = { status?: number | string; response?: { status?: number | string } };

export function getErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as ErrorWithStatus;
  const directStatus = candidate.status ?? candidate.response?.status;
  if (typeof directStatus === "number" && Number.isFinite(directStatus)) return directStatus;
  if (typeof directStatus === "string" && directStatus.trim()) {
    const parsed = Number.parseInt(directStatus, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (err instanceof Error) {
    const match = /LLM API error:\s*(\d{3})/i.exec(err.message);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function logByStatus(context: Context, message: string, metadata: Record<string, unknown>) {
  const status = getErrorStatus(metadata.err);
  const payload = { ...metadata, ...(status ? { status } : {}) };
  if (status && status >= 500) return context.logger.error(message, payload);
  if (status && status >= 400) return context.logger.warn(message, payload);
  if (status && status >= 300) return context.logger.debug(message, payload);
  if (status && status >= 200) return context.logger.ok(message, payload);
  if (status && status >= 100) return context.logger.info(message, payload);
  return context.logger.error(message, payload);
}

export function transformError(context: Context, error: unknown): LogReturn {
  if (error instanceof LogReturn) {
    return error;
  }

  if (error instanceof AggregateError) {
    const message = error.errors
      .map((err) => {
        if (err instanceof LogReturn) {
          return err.logMessage.raw;
        }
        if (err instanceof Error) {
          return err.message;
        }
        return String(err);
      })
      .join("\n\n");
    return logByStatus(context, message, { err: error });
  }

  if (error instanceof Error) {
    return logByStatus(context, error.message, { err: error });
  }

  return logByStatus(context, String(error), { err: error });
}
