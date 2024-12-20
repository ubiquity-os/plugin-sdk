import { LogReturn, Metadata } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "./context";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { sanitizeMetadata } from "./util";

const HEADER_NAME = "UbiquityOS";

/**
 * Posts a comment on a GitHub issue if the issue exists in the context payload, embedding structured metadata to it.
 */
export async function postComment(context: Context, message: LogReturn | Error, raw = false) {
  let issueNumber;

  if ("issue" in context.payload) {
    issueNumber = context.payload.issue.number;
  } else if ("pull_request" in context.payload) {
    issueNumber = context.payload.pull_request.number;
  } else if ("discussion" in context.payload) {
    issueNumber = context.payload.discussion.number;
  } else {
    context.logger.info("Cannot post comment because issue is not found in the payload.");
    return;
  }

  if ("repository" in context.payload && context.payload.repository?.owner?.login) {
    const body = await createStructuredMetadataWithMessage(context, message, raw);
    await context.octokit.rest.issues.createComment({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      issue_number: issueNumber,
      body: body,
    });
  } else {
    context.logger.info("Cannot post comment because repository is not found in the payload.", { payload: context.payload });
  }
}

async function createStructuredMetadataWithMessage(context: Context, message: LogReturn | Error, raw = false) {
  let logMessage;
  let callingFnName;
  let instigatorName;
  let metadata: Metadata;

  if (message instanceof Error) {
    metadata = {
      message: message.message,
      name: message.name,
      stack: message.stack,
    };
    callingFnName = message.stack?.split("\n")[2]?.match(/at (\S+)/)?.[1] ?? "anonymous";
  } else if (message.metadata) {
    logMessage = message.logMessage;
    metadata = message.metadata;

    if (metadata.stack || metadata.error) {
      metadata.stack = metadata.stack || metadata.error?.stack;
      metadata.caller = metadata.caller || metadata.error?.stack?.split("\n")[2]?.match(/at (\S+)/)?.[1];
    }
    callingFnName = metadata.caller;
  } else {
    metadata = { ...message };
  }
  const jsonPretty = sanitizeMetadata(metadata);

  if ("installation" in context.payload && context.payload.installation && "account" in context.payload.installation) {
    instigatorName = context.payload.installation?.account?.name;
  } else {
    instigatorName = context.payload.sender?.login || HEADER_NAME;
  }
  const runUrl = PluginRuntimeInfo.getInstance().runUrl;
  const version = await PluginRuntimeInfo.getInstance().version;

  const ubiquityMetadataHeader = `<!-- ${HEADER_NAME} - @${instigatorName} - ${runUrl} - ${callingFnName} - ${version}`;

  let metadataSerialized: string;
  const metadataSerializedVisible = ["```json", jsonPretty, "```"].join("\n");
  const metadataSerializedHidden = [ubiquityMetadataHeader, jsonPretty, "-->"].join("\n");

  if (logMessage?.type === "fatal") {
    // if the log message is fatal, then we want to show the metadata
    metadataSerialized = [metadataSerializedVisible, metadataSerializedHidden].join("\n");
  } else {
    // otherwise we want to hide it
    metadataSerialized = metadataSerializedHidden;
  }

  if (message instanceof Error) {
    const content = context.logger.error(message.message).logMessage;
    return `${raw ? content.raw : content.diff}\n\n${metadataSerialized}\n`;
  }

  // Add carriage returns to avoid any formatting issue
  return `${raw ? logMessage?.raw : logMessage?.diff}\n\n${metadataSerialized}\n`;
}
