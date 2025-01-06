import { describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Context, postComment } from "../src";

describe("Post comment tests", () => {
  it("Should reuse a message if the reuse option is true", async () => {
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
    jest.unstable_mockModule("@octokit/core", () => ({
      Octokit: jest.fn(() => ({
        rest: {
          issues: {
            createComment,
            updateComment,
          },
        },
      })),
    }));
    const { Octokit } = await import("@octokit/core");
    const ctx = {
      payload: {
        issue: {
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
      octokit: new Octokit(),
    } as unknown as Context;
    await postComment(ctx, logger.ok("test"), { updateComment: true });
    await postComment(ctx, logger.ok("test 2"), { updateComment: true });
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
  });
});
