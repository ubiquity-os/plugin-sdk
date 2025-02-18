import { LogReturn } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "./context";

export function transformError(context: Context, error: unknown) {
  let loggerError: LogReturn | Error;
  if (error instanceof AggregateError) {
    loggerError = context.logger.error(
      error.errors
        .map((err) => {
          if (err instanceof LogReturn) {
            return err.logMessage.raw;
          } else if (err instanceof Error) {
            return err.message;
          } else {
            return err;
          }
        })
        .join("\n\n"),
      { error }
    );
  } else if (error instanceof Error || error instanceof LogReturn) {
    loggerError = error;
  } else {
    loggerError = context.logger.error(String(error));
  }

  return loggerError;
}
