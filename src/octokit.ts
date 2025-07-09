import { Octokit } from "@octokit/core";
import { paginateGraphQL } from "@octokit/plugin-paginate-graphql";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { RequestOptions } from "@octokit/types";

const defaultOptions = {
  throttle: {
    onAbuseLimit: (retryAfter: number, options: RequestOptions, octokit: Octokit) => {
      octokit.log.warn(`Abuse limit hit with "${options.method} ${options.url}", retrying in ${retryAfter} seconds.`);
      return true;
    },
    onRateLimit: (retryAfter: number, options: RequestOptions, octokit: Octokit) => {
      octokit.log.warn(`Rate limit hit with "${options.method} ${options.url}", retrying in ${retryAfter} seconds.`);
      return true;
    },
    onSecondaryRateLimit: (retryAfter: number, options: RequestOptions, octokit: Octokit) => {
      octokit.log.warn(`Secondary rate limit hit with "${options.method} ${options.url}", retrying in ${retryAfter} seconds.`);
      return true;
    },
  },
};

export type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

export const customOctokit = Octokit.plugin(throttling, retry, paginateRest, restEndpointMethods, paginateGraphQL).defaults((instanceOptions: object) => {
  return { ...defaultOptions, ...instanceOptions };
});
