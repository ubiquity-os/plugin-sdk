import { describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import type { Context } from "../src/context";

describe("Pull-request comment tests", () => {
  it("Should be able to post to issues and pull-request reviews", async () => {
    const logger = new Logs("debug");
    const createComment = jest.fn(() => ({
      data: {
        id: 1234,
      },
    }));
    const updateComment = jest.fn(() => ({
      data: {
        id: 1234,
      },
    }));
    const createReplyForReviewComment = jest.fn(() => ({
      data: {
        id: 5678,
      },
    }));
    const updateReviewComment = jest.fn(() => ({
      data: {
        id: 5678,
      },
    }));
    const octokit = {
      rest: {
        issues: {
          createComment,
          updateComment,
        },
        pulls: {
          createReplyForReviewComment,
          updateReviewComment,
        },
      },
    };
    const { CommentHandler } = await import("../src/comment.js");
    const ctxIssue = {
      payload: {
        pull_request: {
          number: 1,
        },
        repository: {
          owner: {
            login: "ubiquity-os",
          },
          name: "plugin-sdk",
        },
      },
      logger,
      octokit,
    } as unknown as Context;
    const ctxReviewComment = {
      payload: {
        pull_request: {
          number: 1,
        },
        comment: {
          id: 2,
        },
        repository: {
          owner: {
            login: "ubiquity-os",
          },
          name: "plugin-sdk",
        },
      },
      logger,
      octokit,
    } as unknown as Context;
    const commentHandler = new CommentHandler();
    await commentHandler.postComment(ctxIssue, logger.ok("test"), { updateComment: true });
    await commentHandler.postComment(ctxIssue, logger.ok("test 2"), { updateComment: true });
    await commentHandler.postComment(ctxReviewComment, logger.ok("test 3"), { updateComment: true });
    await commentHandler.postComment(ctxReviewComment, logger.ok("test 4"), { updateComment: true });
    expect(createComment).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "plugin-sdk",
      issue_number: 1,
      body: expect.anything(),
    });
    expect(updateComment).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "plugin-sdk",
      comment_id: 1234,
      body: expect.anything(),
    });
    expect(createReplyForReviewComment).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "plugin-sdk",
      pull_number: 1,
      comment_id: 2,
      body: expect.anything(),
    });
    expect(updateReviewComment).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "plugin-sdk",
      comment_id: 5678,
      body: expect.anything(),
    });
  });
});
