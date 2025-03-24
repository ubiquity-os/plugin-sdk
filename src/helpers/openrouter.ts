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

export type OpenRouterModel = {
  id: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
  top_provider: {
    context_length: number;
    /** `null` means it's the same as the context_length */
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
    input_cache_read: string;
    input_cache_write: string;
    web_search: string;
    internal_reasoning: string;
  };
  per_request_limits?: Record<string, unknown>;
};

export async function getOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) {
    throw new Error("Failed to fetch models");
  }
  const result = (await response.json()) as { data: OpenRouterModel[] };
  return result.data;
}

export async function getOpenRouterModelTokenLimits(modelId: string) {
  const models = await getOpenRouterModels();
  const model = models.find((m) => m.id === modelId);
  if (!model) {
    return null;
  }
  return {
    contextLength: model.context_length,
    maxCompletionTokens: model.top_provider.max_completion_tokens || model.context_length,
  };
}
