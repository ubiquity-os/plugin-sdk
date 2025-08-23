import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";

describe("Post comment tests", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("Should reuse a message if the reuse option is true", async () => {
    const logger = new Logs("debug");
    const { CommentHandler } = await import("../src");
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
    const c = jest.unstable_mockModule("@octokit/core", () => ({
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
    c.clearAllMocks();
  });

  it("Should construct the body and link the metadata properly", async () => {
    jest.unstable_mockModule("@octokit/core", () => ({
      Octokit: {
        plugin: jest.fn(() => ({
          defaults: jest.fn(),
        })),
      },
    }));
    jest.unstable_mockModule("../src/helpers/runtime-info", () => ({
      PluginRuntimeInfo: {
        getInstance: jest.fn(() => ({
          version: "1.0.0",
          runUrl: "https://localhost",
        })),
      },
    }));
    const { CommentHandler } = await import("../src");
    const commentHandler = new CommentHandler();
    const logger = new Logs("debug");
    let body = commentHandler.createCommentBody(
      {
        logger,
        payload: {},
      } as never,
      logger.ok("My cool message")
    );
    expect(body).toEqual(`> [!TIP]
> My cool message

<!-- UbiquityOS - Object.<anonymous> - 1.0.0 - @UbiquityOS - https://localhost
{
  "caller": "Object.&lt;anonymous&gt;"
}
-->
`);
    body = commentHandler.createCommentBody(
      {
        logger,
        payload: {},
      } as never,
      logger.ok("My cool message"),
      { raw: true }
    );
    expect(body).toEqual(`My cool message

<!-- UbiquityOS - Object.<anonymous> - 1.0.0 - @UbiquityOS - https://localhost
{
  "caller": "Object.&lt;anonymous&gt;"
}
-->
`);
  });
});
