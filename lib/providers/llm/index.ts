import { ProviderError } from "../errors";
import type { LlmProvider } from "./types";
import { openAiLlmProvider } from "./openai";
import { localLlmProvider } from "./local";
import { qwenLlmProvider } from "./qwen";

export function getLlmProvider(): LlmProvider {
  const providerName = process.env.LLM_PROVIDER || "local";

  if (providerName === "local") {
    return localLlmProvider;
  }

  if (providerName === "qwen") {
    return qwenLlmProvider;
  }

  if (providerName === "openai") {
    return openAiLlmProvider;
  }

  throw new ProviderError(`暂不支持大模型供应商：${providerName}`, 400);
}
