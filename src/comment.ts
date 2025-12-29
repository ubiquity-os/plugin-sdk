import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { LogReturn, Metadata } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "./context";
import { getErrorStatus } from "./error";
import { PluginRuntimeInfo } from "./helpers/runtime-info";
import { sanitizeMetadata } from "./util";

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

export type PostedGithubComment =
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

function logByStatus(logger: Context["logger"], message: string, status: number | null, metadata: Record<string, unknown>): LogReturn {
  const payload = { ...metadata, ...(status ? { status } : {}) };
  if (status && status >= 500) return logger.error(message, payload);
  if (status && status >= 400) return logger.warn(message, payload);
  if (status && status >= 300) return logger.debug(message, payload);
  if (status && status >= 200) return logger.ok(message, payload);
  if (status && status >= 100) return logger.info(message, payload);
  return logger.error(message, payload);
}

export class CommentHandler {
  public static readonly HEADER_NAME = "UbiquityOS";
  private _lastCommentId = { reviewCommentId: null as number | null, issueCommentId: null as number | null };

  async _updateIssueComment(
    context: Context,
    params: { owner: string; repo: string; body: string; issueNumber: number }
  ): Promise<WithIssueNumber<PostedGithubComment>> {
    if (!this._lastCommentId.issueCommentId) {
      throw context.logger.error("issueCommentId is missing");
    }
    const commentData = await context.octokit.rest.issues.updateComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: this._lastCommentId.issueCommentId,
      body: params.body,
    });
    return { ...commentData.data, issueNumber: params.issueNumber };
  }

  async _updateReviewComment(
    context: Context,
    params: { owner: string; repo: string; body: string; issueNumber: number }
  ): Promise<WithIssueNumber<PostedGithubComment>> {
    if (!this._lastCommentId.reviewCommentId) {
      throw context.logger.error("reviewCommentId is missing");
    }
    const commentData = await context.octokit.rest.pulls.updateReviewComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: this._lastCommentId.reviewCommentId,
      body: params.body,
    });
    return { ...commentData.data, issueNumber: params.issueNumber };
  }

  async _createNewComment(
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
      this._lastCommentId.reviewCommentId = commentData.data.id;
      return { ...commentData.data, issueNumber: params.issueNumber };
    }

    const commentData = await context.octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      body: params.body,
    });
    this._lastCommentId.issueCommentId = commentData.data.id;
    return { ...commentData.data, issueNumber: params.issueNumber };
  }

  _getIssueNumber(context: Context): number | undefined {
    if ("issue" in context.payload) return context.payload.issue.number;
    if ("pull_request" in context.payload) return context.payload.pull_request.number;
    if ("discussion" in context.payload) return context.payload.discussion.number;
    return undefined;
  }

  _getCommentId(context: Context): number | undefined {
    return "pull_request" in context.payload && "comment" in context.payload ? context.payload.comment.id : undefined;
  }

  _extractIssueContext(context: Context): IssueContext | null {
    if (!("repository" in context.payload) || !context.payload.repository?.owner?.login) {
      return null;
    }

    const issueNumber = this._getIssueNumber(context);
    if (!issueNumber) return null;

    return {
      issueNumber,
      commentId: this._getCommentId(context),
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
    };
  }

  _processMessage(context: Context, message: LogReturn | Error) {
    if (message instanceof Error) {
      const metadata = {
        message: message.message,
        name: message.name,
        stack: message.stack,
      };
      const status = getErrorStatus(message);
      const logReturn = logByStatus(context.logger, message.message, status, metadata);
      return { metadata: { ...metadata, ...(status ? { status } : {}) }, logMessage: logReturn.logMessage };
    }

    const stackLine = message.metadata?.error?.stack?.split("\n")[2];
    const callerMatch = stackLine ? /at (\S+)/.exec(stackLine) : null;
    const metadata = message.metadata
      ? {
          ...message.metadata,
          message: message.metadata.message,
          stack: message.metadata.stack || message.metadata.error?.stack,
          caller: message.metadata.caller || callerMatch?.[1],
        }
      : { ...message };

    return { metadata, logMessage: message.logMessage };
  }

  _getInstigatorName(context: Context): string {
    if (
      "installation" in context.payload &&
      context.payload.installation &&
      "account" in context.payload.installation &&
      context.payload.installation?.account?.name
    ) {
      return context.payload.installation?.account?.name;
    }
    return context.payload.sender?.login || CommentHandler.HEADER_NAME;
  }

  _createMetadataContent(context: Context, metadata: Metadata) {
    const jsonPretty = sanitizeMetadata(metadata);
    const instigatorName = this._getInstigatorName(context);
    const runUrl = PluginRuntimeInfo.getInstance().runUrl;
    const version = PluginRuntimeInfo.getInstance().version;
    const callingFnName = metadata.caller || "anonymous";

    return {
      header: `<!-- ${CommentHandler.HEADER_NAME} - ${callingFnName} - ${version} - @${instigatorName} - ${runUrl}`,
      jsonPretty,
    };
  }

  _formatMetadataContent(logMessage: LogReturn["logMessage"], header: string, jsonPretty: string): string {
    const metadataVisible = ["```json", jsonPretty, "```"].join("\n");
    const metadataHidden = [header, jsonPretty, "-->"].join("\n");

    return logMessage?.type === "fatal" ? [metadataVisible, metadataHidden].join("\n") : metadataHidden;
  }

  /*
   * Creates the body for the comment, embeds the metadata and the header hidden in the body as well.
   */
  public createCommentBody(context: Context, message: LogReturn | Error, options?: Pick<CommentOptions, "raw">): string {
    return this._createCommentBody(context, message, options);
  }

  private _createCommentBody(context: Context, message: LogReturn | Error, options?: CommentOptions): string {
    const { metadata, logMessage } = this._processMessage(context, message);
    const { header, jsonPretty } = this._createMetadataContent(context, metadata);
    const metadataContent = this._formatMetadataContent(logMessage, header, jsonPretty);

    return `${options?.raw ? logMessage?.raw : logMessage?.diff}\n\n${metadataContent}\n`;
  }

  async postComment(
    context: Context,
    message: LogReturn | Error,
    options: CommentOptions = { updateComment: true, raw: false }
  ): Promise<WithIssueNumber<PostedGithubComment> | null> {
    const issueContext = this._extractIssueContext(context);
    if (!issueContext) {
      context.logger.warn("Cannot post comment: missing issue context in payload");
      return null;
    }

    const body = this._createCommentBody(context, message, options);
    const { issueNumber, commentId, owner, repo } = issueContext;
    const params = { owner, repo, body, issueNumber };

    if (options.updateComment) {
      if (this._lastCommentId.issueCommentId && !("pull_request" in context.payload && "comment" in context.payload)) {
        return this._updateIssueComment(context, params);
      }

      if (this._lastCommentId.reviewCommentId && "pull_request" in context.payload && "comment" in context.payload) {
        return this._updateReviewComment(context, params);
      }
    }

    return this._createNewComment(context, { ...params, commentId });
  }
}
