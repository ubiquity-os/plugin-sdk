export type OpenRouterError = {
  error: {
    message: string;
    code: number;
    metadata?:
      | { provider_name: string; raw: unknown }
      | {
          reasons: string[];
          flagged_input: string;
          provider_name: string;
          model_slug: string;
        };
  };
};
