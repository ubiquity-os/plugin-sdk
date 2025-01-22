import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import { LogReturn, Metadata } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "./context";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { sanitizeMetadata } from "./util";

const HEADER_NAME = "UbiquityOS";

export interface CommentOptions {
  /*
   * Should the comment be posted as send within the log, without adding any sort of formatting.
   */
  raw?: boolean;
  /*
   * Should the previously posted comment be reused instead of posting a new comment.
   */
  updateComment?: boolean;
}

export type PostComment = {
  (
    context: Context,
    message: LogReturn | Error,
    options?: CommentOptions
  ): Promise<
    RestEndpointMethodTypes["issues"]["updateComment"]["response"]["data"] | RestEndpointMethodTypes["issues"]["createComment"]["response"]["data"] | null
  >;
  lastCommentId?: number;
};

/**
 * Posts a comment on a GitHub issue if the issue exists in the context payload, embedding structured metadata to it.
 */
export const postComment: PostComment = async function (
  context: Context,
  message: LogReturn | Error,
  options: CommentOptions = { updateComment: true, raw: false }
) {
  let issueNumber;

  if ("issue" in context.payload) {
    issueNumber = context.payload.issue.number;
  } else if ("pull_request" in context.payload) {
    issueNumber = context.payload.pull_request.number;
  } else if ("discussion" in context.payload) {
    issueNumber = context.payload.discussion.number;
  } else {
    context.logger.info("Cannot post comment because issue is not found in the payload.");
    return null;
  }

  if ("repository" in context.payload && context.payload.repository?.owner?.login) {
    const body = await createStructuredMetadataWithMessage(context, message, options);
    if (options.updateComment && postComment.lastCommentId) {
      const commentData = await context.octokit.rest.issues.updateComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        comment_id: postComment.lastCommentId,
        body: body,
      });
      return commentData.data;
    } else {
      const commentData = await context.octokit.rest.issues.createComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        issue_number: issueNumber,
        body: body,
      });
      postComment.lastCommentId = commentData.data.id;
      return commentData.data;
    }
  } else {
    context.logger.info("Cannot post comment because repository is not found in the payload.", { payload: context.payload });
  }
  return null;
};

async function createStructuredMetadataWithMessage(context: Context, message: LogReturn | Error, options: CommentOptions) {
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
    logMessage = context.logger.error(message.message).logMessage;
  } else if (message.metadata) {
    metadata = {
      message: message.metadata.message,
      stack: message.metadata.stack || message.metadata.error?.stack,
      caller: message.metadata.caller || message.metadata.error?.stack?.split("\n")[2]?.match(/at (\S+)/)?.[1],
    };
    logMessage = message.logMessage;
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

  const ubiquityMetadataHeader = `<!-- ${HEADER_NAME} - ${callingFnName} - ${version} - @${instigatorName} - ${runUrl}`;

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

  // Add carriage returns to avoid any formatting issue
  return `${options.raw ? logMessage?.raw : logMessage?.diff}\n\n${metadataSerialized}\n`;
}
