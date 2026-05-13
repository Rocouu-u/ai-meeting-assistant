import { ProviderError } from "../errors";
import type { LlmProvider } from "./types";

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

export const openAiLlmProvider: LlmProvider = {
  name: "openai",
  async generateMeetingReport({ transcript }) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new ProviderError("还没有配置 OpenAI API Key。OpenAI 现在只是海外备选方案。", 400);
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        instructions:
          "你是专业的中文会议纪要助手。请根据会议转写内容，生成清晰、简洁、适合商务场景的会议纪要和报告提纲。只返回 JSON，不要返回 Markdown。",
        input: `请根据下面的会议转写文本生成结果。\n\n要求：\n1. 返回 JSON，格式为 { "summary": "...", "outline": "..." }。\n2. summary 使用中文，包含：会议主题、会议结论、待办事项、风险与备注。\n3. outline 使用中文，适合作为正式汇报材料提纲。\n4. 不要编造转写文本中没有的信息。\n\n会议转写：\n${transcript}`,
        max_output_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new ProviderError("OpenAI 生成失败，请检查 API Key、模型权限或稍后再试。", 502);
    }

    const result = (await response.json()) as OpenAIResponse;
    const outputText = extractOutputText(result);
    const parsed = parseGeneratedReport(outputText);

    return {
      message: "会议纪要和报告提纲已生成。",
      summary: parsed.summary,
      outline: parsed.outline
    };
  }
};

function extractOutputText(response: OpenAIResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function parseGeneratedReport(outputText: string) {
  try {
    const parsed = JSON.parse(outputText) as {
      summary?: string;
      outline?: string;
    };

    return {
      summary: parsed.summary?.trim() || outputText,
      outline: parsed.outline?.trim() || "请根据会议纪要继续整理报告提纲。"
    };
  } catch {
    return {
      summary: outputText || "生成结果为空，请稍后重试。",
      outline: "请根据会议纪要继续整理报告提纲。"
    };
  }
}
