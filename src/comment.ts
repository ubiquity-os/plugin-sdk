import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { LogReturn, Metadata } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "./context";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { sanitizeMetadata } from "./util";

const HEADER_NAME = "UbiquityOS";
const lastCommentId = { reviewCommentId: null as number | null, issueCommentId: null as number | null };

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

type PostedGithubComment =
  | RestEndpointMethodTypes["issues"]["updateComment"]["response"]["data"]
  | RestEndpointMethodTypes["issues"]["createComment"]["response"]["data"]
  | RestEndpointMethodTypes["pulls"]["createReplyForReviewComment"]["response"]["data"];

type WithIssueNumber<T> = T & {
  issueNumber: number;
};

interface IssueContext {
  issueNumber: number;
  commentId?: number;
  owner: string;
  repo: string;
}

async function updateIssueComment(
  context: Context,
  params: { owner: string; repo: string; body: string; issueNumber: number }
): Promise<WithIssueNumber<PostedGithubComment>> {
  if (!lastCommentId.issueCommentId) {
    throw context.logger.error("issueCommentId is missing");
  }
  const commentData = await context.octokit.rest.issues.updateComment({
    owner: params.owner,
    repo: params.repo,
    comment_id: lastCommentId.issueCommentId,
    body: params.body,
  });
  return { ...commentData.data, issueNumber: params.issueNumber };
}

async function updateReviewComment(
  context: Context,
  params: { owner: string; repo: string; body: string; issueNumber: number }
): Promise<WithIssueNumber<PostedGithubComment>> {
  if (!lastCommentId.reviewCommentId) {
    throw context.logger.error("reviewCommentId is missing");
  }
  const commentData = await context.octokit.rest.pulls.updateReviewComment({
    owner: params.owner,
    repo: params.repo,
    comment_id: lastCommentId.reviewCommentId,
    body: params.body,
  });
  return { ...commentData.data, issueNumber: params.issueNumber };
}

async function createNewComment(
  context: Context,
  params: { owner: string; repo: string; body: string; issueNumber: number; commentId?: number }
): Promise<WithIssueNumber<PostedGithubComment>> {
  if (params.commentId) {
    const commentData = await context.octokit.rest.pulls.createReplyForReviewComment({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.issueNumber,
      comment_id: params.commentId,
      body: params.body,
    });
    lastCommentId.reviewCommentId = commentData.data.id;
    return { ...commentData.data, issueNumber: params.issueNumber };
  }

  const commentData = await context.octokit.rest.issues.createComment({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: params.body,
  });
  lastCommentId.issueCommentId = commentData.data.id;
  return { ...commentData.data, issueNumber: params.issueNumber };
}

function getIssueNumber(context: Context): number | undefined {
  if ("issue" in context.payload) return context.payload.issue.number;
  if ("pull_request" in context.payload) return context.payload.pull_request.number;
  if ("discussion" in context.payload) return context.payload.discussion.number;
  return undefined;
}

function getCommentId(context: Context): number | undefined {
  return "pull_request" in context.payload && "comment" in context.payload ? context.payload.comment.id : undefined;
}

function extractIssueContext(context: Context): IssueContext | null {
  if (!("repository" in context.payload) || !context.payload.repository?.owner?.login) {
    return null;
  }

  const issueNumber = getIssueNumber(context);
  if (!issueNumber) return null;

  return {
    issueNumber,
    commentId: getCommentId(context),
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
  };
}

async function processMessage(context: Context, message: LogReturn | Error) {
  if (message instanceof Error) {
    const metadata = {
      message: message.message,
      name: message.name,
      stack: message.stack,
    };
    return { metadata, logMessage: context.logger.error(message.message).logMessage };
  }

  const metadata = message.metadata
    ? {
        ...message.metadata,
        message: message.metadata.message,
        stack: message.metadata.stack || message.metadata.error?.stack,
        caller: message.metadata.caller || message.metadata.error?.stack?.split("\n")[2]?.match(/at (\S+)/)?.[1],
      }
    : { ...message };

  return { metadata, logMessage: message.logMessage };
}

function getInstigatorName(context: Context): string {
  if (
    "installation" in context.payload &&
    context.payload.installation &&
    "account" in context.payload.installation &&
    context.payload.installation?.account?.name
  ) {
    return context.payload.installation?.account?.name;
  }
  return context.payload.sender?.login || HEADER_NAME;
}

async function createMetadataContent(context: Context, metadata: Metadata) {
  const jsonPretty = sanitizeMetadata(metadata);
  const instigatorName = getInstigatorName(context);
  const runUrl = PluginRuntimeInfo.getInstance().runUrl;
  const version = await PluginRuntimeInfo.getInstance().version;
  const callingFnName = metadata.caller || "anonymous";

  return {
    header: `<!-- ${HEADER_NAME} - ${callingFnName} - ${version} - @${instigatorName} - ${runUrl}`,
    jsonPretty,
  };
}

function formatMetadataContent(logMessage: LogReturn["logMessage"], header: string, jsonPretty: string): string {
  const metadataVisible = ["```json", jsonPretty, "```"].join("\n");
  const metadataHidden = [header, jsonPretty, "-->"].join("\n");

  return logMessage?.type === "fatal" ? [metadataVisible, metadataHidden].join("\n") : metadataHidden;
}

async function createCommentBody(context: Context, message: LogReturn | Error, options: CommentOptions): Promise<string> {
  const { metadata, logMessage } = await processMessage(context, message);
  const { header, jsonPretty } = await createMetadataContent(context, metadata);
  const metadataContent = formatMetadataContent(logMessage, header, jsonPretty);

  return `${options.raw ? logMessage?.raw : logMessage?.diff}\n\n${metadataContent}\n`;
}

export async function postComment(
  context: Context,
  message: LogReturn | Error,
  options: CommentOptions = { updateComment: true, raw: false }
): Promise<WithIssueNumber<PostedGithubComment> | null> {
  const issueContext = extractIssueContext(context);
  if (!issueContext) {
    context.logger.info("Cannot post comment: missing issue context in payload");
    return null;
  }

  const body = await createCommentBody(context, message, options);
  const { issueNumber, commentId, owner, repo } = issueContext;
  const params = { owner, repo, body, issueNumber };

  if (options.updateComment) {
    if (lastCommentId.issueCommentId && !("pull_request" in context.payload && "comment" in context.payload)) {
      return updateIssueComment(context, params);
    }

    if (lastCommentId.reviewCommentId && "pull_request" in context.payload && "comment" in context.payload) {
      return updateReviewComment(context, params);
    }
  }

  return createNewComment(context, { ...params, commentId });
}
