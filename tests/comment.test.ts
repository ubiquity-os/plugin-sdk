import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";

describe("Post comment tests", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

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
    const { CommentHandler } = await import("../src/comment");
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
      octokit: {
        rest: {
          issues: {
            createComment,
            updateComment,
          },
        },
      },
    } as never;
    const commentHandler = new CommentHandler();
    await commentHandler.postComment(ctx, logger.ok("test"), { updateComment: true });
    await commentHandler.postComment(ctx, logger.ok("test 2"), { updateComment: true });
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

  it("Should construct the body and link the metadata properly", async () => {
    const { CommentHandler } = await import("../src/comment");
    const runtimeInfo = await import("../src/helpers/runtime-info");
    const runtimeInfoSpy = jest.spyOn(runtimeInfo.PluginRuntimeInfo, "getInstance").mockReturnValue({
      version: "1.0.0",
      runUrl: "https://localhost",
    } as never);
    const commentHandler = new CommentHandler();
    const logger = new Logs("debug");
    let body = commentHandler.createCommentBody(
      {
        logger,
        payload: {},
      } as never,
      logger.ok("My cool message")
    );
    expect(body).toContain("> [!TIP]\n> My cool message\n");
    expect(body).toMatch(/<!-- UbiquityOS - .+ - 1.0.0 - @UbiquityOS - https:\/\/localhost/);
    expect(body).toMatch(/"caller": ".+"/);
    body = commentHandler.createCommentBody(
      {
        logger,
        payload: {},
      } as never,
      logger.ok("My cool message"),
      { raw: true }
    );
    expect(body).toContain("My cool message\n");
    expect(body).toMatch(/<!-- UbiquityOS - .+ - 1.0.0 - @UbiquityOS - https:\/\/localhost/);
    expect(body).toMatch(/"caller": ".+"/);
    runtimeInfoSpy.mockRestore();
  });
});
