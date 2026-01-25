import { TypeBoxError } from "@sinclair/typebox";
import { LogReturn } from "@ubiquity-os/ubiquity-os-logger";

const EMPTY_STRING = String();

interface RetryOptions {
  maxRetries: number;
  onError?: (error: unknown) => Promise<void> | void;
  /** Return `false` to stop retrying, `true` to automatically delay the next retry, or a number to set the delay before the next retry */
  isErrorRetryable?: (error: unknown) => Promise<boolean | number> | boolean | number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let delay = 1000;
  let lastError: unknown = null;
  for (let i = 0; i < options.maxRetries + 1; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (options.onError) {
        await options.onError(err);
      }
      let shouldRetry;
      if (options.isErrorRetryable) {
        shouldRetry = await options.isErrorRetryable(err);
      }
      if (shouldRetry === false) {
        throw lastError;
      } else if (typeof shouldRetry === "number" && Number.isFinite(shouldRetry)) {
        await sleep(shouldRetry);
      } else {
        await sleep(delay);
        delay *= 2;
      }
    }
  }
  throw lastError;
}

// eslint-disable-next-line sonarjs/function-return-type
export function checkLlmRetryableState(error: unknown): boolean | number {
  if (error instanceof SyntaxError || error instanceof TypeBoxError || error instanceof LogReturn) {
    return true;
  }

  const status = extractStatus(error) ?? extractStatusFromMessage(error);
  if (!status) return false;

  if (status === 429) {
    const headers = extractHeaders(error);
    const tokenDelay = parseRetryAfter(headers, "x-ratelimit-reset-tokens");
    const requestDelay = parseRetryAfter(headers, "x-ratelimit-reset-requests");
    const retryAfter = parseRetryAfter(headers, "retry-after");
    const delays = [tokenDelay, requestDelay, retryAfter].filter((value): value is number => Number.isFinite(value));
    if (!delays.length) return true;
    return Math.max(...delays);
  }

  return status >= 500;
}

function extractStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const maybeError = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const candidates: unknown[] = [maybeError.status, maybeError.statusCode, maybeError.response?.status];
  const maybeCause = maybeError.cause;
  if (typeof maybeCause === "object" && maybeCause !== null) {
    const cause = maybeCause as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    candidates.push(cause.status, cause.statusCode, cause.response?.status);
  }
  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
  }
  return null;
}

function extractStatusFromMessage(error: unknown): number | null {
  let message: string | undefined;

  if (typeof error === "string") {
    message = error;
  } else if (typeof error === "object" && error !== null && "message" in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      message = maybeMessage;
    }
  }

  if (!message) return null;
  const normalized = message.toLowerCase();
  const keywords = ["status code", "status", "http", "error"];
  for (const keyword of keywords) {
    let index = normalized.indexOf(keyword);
    while (index !== -1) {
      const tail = normalized.slice(index + keyword.length);
      const status = parseStatusFromTail(tail);
      if (status !== null) return status;
      index = normalized.indexOf(keyword, index + keyword.length);
    }
  }
  return null;
}

function parseStatusFromTail(value: string): number | null {
  let digits = EMPTY_STRING;
  for (let i = 0; i < value.length; i++) {
    const result = consumeStatusChar(value, i, digits);
    digits = result.digits;
    if (result.status !== null) return result.status;
  }
  return null;
}

function consumeStatusChar(value: string, index: number, digits: string): { digits: string; status: number | null } {
  const char = value[index];
  if (!isDigit(char)) return { digits: EMPTY_STRING, status: null };

  const nextDigits = digits + char;
  if (nextDigits.length > 3) return { digits: EMPTY_STRING, status: null };
  if (nextDigits.length < 3) return { digits: nextDigits, status: null };
  if (hasNextDigit(value, index)) return { digits: EMPTY_STRING, status: null };

  return { digits: EMPTY_STRING, status: parseStatusDigits(nextDigits) };
}

function hasNextDigit(value: string, index: number): boolean {
  return isDigit(value[index + 1] ?? EMPTY_STRING);
}

function parseStatusDigits(value: string): number | null {
  const status = Number.parseInt(value, 10);
  return Number.isFinite(status) ? status : null;
}

function extractHeaders(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  const maybeError = error as { headers?: unknown; response?: { headers?: unknown }; cause?: unknown };
  if (maybeError.headers) return maybeError.headers;
  if (maybeError.response?.headers) return maybeError.response.headers;
  const maybeCause = maybeError.cause;
  if (typeof maybeCause === "object" && maybeCause !== null) {
    const cause = maybeCause as { headers?: unknown; response?: { headers?: unknown } };
    if (cause.headers) return cause.headers;
    if (cause.response?.headers) return cause.response.headers;
  }
  return undefined;
}

function parseRetryAfter(headers: unknown, headerName: string): number | null {
  const value = getHeaderValue(headers, headerName);
  if (!value) return null;
  const delay = parseDelayMs(value, headerName.toLowerCase() === "retry-after");
  return Number.isFinite(delay) ? delay : null;
}

function getHeaderValue(headers: unknown, headerName: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const maybeHeaders = headers as { get?: unknown } & Record<string, unknown>;
  if (typeof maybeHeaders.get === "function") {
    const value = (maybeHeaders.get as (name: string) => string | null)(headerName);
    return typeof value === "string" ? value : undefined;
  }
  const direct = maybeHeaders[headerName] ?? maybeHeaders[headerName.toLowerCase()] ?? maybeHeaders[headerName.toUpperCase()];
  return typeof direct === "string" ? direct : undefined;
}

const UNIT_DELAY_REGEX = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i;
const UNIT_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseDelayMs(value: string, numericIsSeconds: boolean): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericDelay = parseNumericDelay(trimmed, numericIsSeconds);
  if (numericDelay !== null) return numericDelay;

  const unitDelay = parseUnitDelay(trimmed);
  if (unitDelay !== null) return unitDelay;

  return parseDateDelay(trimmed);
}

function parseNumericDelay(value: string, numericIsSeconds: boolean): number | null {
  if (!isPlainNumberString(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numericIsSeconds ? numeric * 1000 : numeric;
}

function isPlainNumberString(value: string): boolean {
  let hasDigit = false;
  let hasDot = false;
  for (const char of value) {
    if (isDigit(char)) {
      hasDigit = true;
      continue;
    }
    if (char === "." && !hasDot) {
      hasDot = true;
      continue;
    }
    return false;
  }
  return hasDigit;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function parseUnitDelay(value: string): number | null {
  const unitMatch = UNIT_DELAY_REGEX.exec(value);
  if (!unitMatch) return null;
  const amount = Number(unitMatch[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = unitMatch[2]?.toLowerCase();
  if (!unit) return null;
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (!multiplier) return null;
  const result = amount * multiplier;
  return Number.isFinite(result) ? result : null;
}

function parseDateDelay(value: string): number | null {
  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) return null;
  const delay = parsedDate - Date.now();
  return delay > 0 ? delay : 0;
}
