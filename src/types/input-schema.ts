import { StaticDecode, Type as T } from "@sinclair/typebox";
import { commandCallSchema } from "./command";
import { jsonType } from "./util";

export const inputSchema = T.Object({
  stateId: T.String(),
  eventName: T.String(),
  eventPayload: jsonType(T.Record(T.String(), T.Any()), true),
  command: jsonType(commandCallSchema),
  authToken: T.String(),
  settings: jsonType(T.Record(T.String(), T.Any())),
  ref: T.String(),
  signature: T.String(),
});

export type InputSchema = StaticDecode<typeof inputSchema>;
