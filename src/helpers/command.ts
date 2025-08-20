import { Value } from "@sinclair/typebox/value";
import { InputSchema } from "../types/input-schema";
import { Options } from "../util";

export function getCommand<TCommand>(inputs: InputSchema, pluginOptions: Options) {
  let command = null as TCommand | null;
  if (inputs.command && pluginOptions.commandSchema) {
    try {
      command = Value.Decode(pluginOptions.commandSchema, Value.Default(pluginOptions.commandSchema, inputs.command));
    } catch (e) {
      console.dir(...Value.Errors(pluginOptions.commandSchema, inputs.command), { depth: null });
      throw e;
    }
  } else if (inputs.command) {
    command = inputs.command as TCommand;
  }
  return command;
}
