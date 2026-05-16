import { ProviderError } from "../errors";
import type { ActionItem, LlmProvider } from "./types";

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
          "你是专业的中文会议纪要助手。请根据会议转写内容，生成清晰、简洁、适合商务场景的会议纪要、报告提纲和行动项矩阵。只返回 JSON，不要返回 Markdown。",
        input: `请根据下面的会议转写文本生成结果。\n\n要求：\n1. 返回 JSON，格式为 { "summary": "...", "actionItems": [], "outline": "..." }。\n2. summary 使用中文，包含：会议主题、会议结论、待办事项、风险与备注。\n3. actionItems 是行动项矩阵，每项包含 topic、owner、expectedResult、deadline、sourceTimestamp。\n4. outline 使用中文，适合作为正式汇报材料提纲。\n5. 没有责任人时 owner 写“未分配”，没有截止时间时 deadline 写“TBD”。\n6. 不要编造转写文本中没有的信息。\n\n会议转写：\n${transcript}`,
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
      message: "会议纪要、报告提纲和行动项矩阵已生成。",
      summary: parsed.summary,
      outline: parsed.outline,
      actionItems: parsed.actionItems
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
      actionItems?: unknown;
    };

    return {
      summary: parsed.summary?.trim() || outputText,
      outline: parsed.outline?.trim() || "请根据会议纪要继续整理报告提纲。",
      actionItems: normalizeActionItems(parsed.actionItems)
    };
  } catch {
    return {
      summary: outputText || "生成结果为空，请稍后重试。",
      outline: "请根据会议纪要继续整理报告提纲。",
      actionItems: []
    };
  }
}

function normalizeActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeActionItem(item))
    .filter((item): item is ActionItem => Boolean(item));
}

function normalizeActionItem(value: unknown): ActionItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const topic = textValue(item.topic) || textValue(item["议题"]);
  const expectedResult = textValue(item.expectedResult) || textValue(item["预期结果"]) || textValue(item.action) || textValue(item["行动项"]);

  return {
    topic: topic || "未明确",
    owner: textValue(item.owner) || textValue(item["责任人"]) || "未分配",
    expectedResult: expectedResult || "未明确",
    deadline: textValue(item.deadline) || textValue(item.dueDate) || textValue(item["截止时间"]) || "TBD",
    sourceTimestamp: textValue(item.sourceTimestamp) || textValue(item["溯源时间戳"]) || textValue(item["来源时间戳"]) || "未明确"
  };
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
