import { ProviderError } from "../errors";
import { buildMeetingSummaryPrompt } from "../../prompts/meeting-summary";
import type { LlmProvider } from "./types";
import { getQwenConfig } from "../../runtime-config";

type QwenChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export const qwenLlmProvider: LlmProvider = {
  name: "qwen",
  async generateMeetingReport({ transcript }) {
    const { apiKey, baseUrl, model } = getQwenConfig();

    if (!apiKey) {
      throw new ProviderError("还没有配置阿里云百炼 API Key。请先在系统配置中填写 DASHSCOPE_API_KEY。", 400);
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是专业的中文会议纪要整理助手。请严格按用户提供的格式输出会议纪要和报告提纲，不要输出无关解释。"
          },
          {
            role: "user",
            content: buildMeetingSummaryPrompt(transcript)
          }
        ],
        temperature: 0.1
      })
    });

    const result = (await response.json()) as QwenChatCompletionResponse;

    if (!response.ok) {
      throw new ProviderError(result.error?.message || "阿里云百炼 Qwen 生成失败，请检查 API Key 或模型权限。", 502);
    }

    const outputText = result.choices?.[0]?.message?.content?.trim();

    if (!outputText) {
      throw new ProviderError("阿里云百炼 Qwen 没有返回生成内容，请稍后再试。", 502);
    }

    const parsed = splitGeneratedReport(outputText);

    return {
      message: "会议纪要和报告提纲已生成。",
      summary: parsed.summary,
      outline: parsed.outline
    };
  }
};

function splitGeneratedReport(outputText: string) {
  const cleanedText = outputText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const outlineHeading = "# 二、报告提纲";
  const outlineStart = cleanedText.indexOf(outlineHeading);

  if (outlineStart >= 0) {
    return {
      summary: cleanedText.slice(0, outlineStart).trim(),
      outline: cleanedText.slice(outlineStart).trim()
    };
  }

  return {
    summary: cleanedText || "生成结果为空，请稍后重试。",
    outline: "未能自动拆分报告提纲，请在会议纪要中查看完整生成结果。"
  };
}
