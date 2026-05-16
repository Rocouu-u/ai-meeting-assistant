import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ProviderError } from "../errors";
import { buildMeetingSummaryPrompt } from "../../prompts/meeting-summary";
import type { ActionItem, LlmProvider } from "./types";

export const localLlmProvider: LlmProvider = {
  name: "local",
  async generateMeetingReport({ transcript }) {
    const prompt = buildMeetingSummaryPrompt(transcript);
    const resultText = await runLocalSummaryModel(prompt);
    const parsed = splitGeneratedReport(resultText);

    return {
      message: "会议纪要、报告提纲和行动项矩阵已生成。",
      summary: parsed.summary,
      outline: parsed.outline,
      actionItems: parsed.actionItems
    };
  }
};

async function runLocalSummaryModel(promptText: string) {
  const tempDir = await mkdtemp(join(tmpdir(), "meeting-ai-summary-"));
  const promptPath = join(tempDir, "prompt.txt");
  const outputPath = join(tempDir, "output.json");

  try {
    await writeFile(promptPath, promptText, "utf-8");
    await runPythonScript(join(process.cwd(), "scripts", "local-summary.py"), [promptPath, outputPath]);
    const raw = await readFile(outputPath, "utf-8");
    const parsed = JSON.parse(raw) as { text?: string };
    return parsed.text?.trim() || "";
  } catch (error) {
    throw providerErrorFromUnknown(error, "本地会议纪要生成失败，请检查 Python 和 Qwen 本地模型环境。");
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runPythonScript(scriptPath: string, args: string[]) {
  const pythonCommand = process.env.LOCAL_PYTHON_PATH || "python3";

  return new Promise<void>((resolve, reject) => {
    const child = spawn(pythonCommand, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env
      }
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `Python 脚本执行失败，退出码 ${code ?? "unknown"}`));
    });
  });
}

function splitGeneratedReport(outputText: string): {
  summary: string;
  outline: string;
  actionItems: ActionItem[];
} {
  const cleanedText = outputText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleanedText) as {
      summary?: string;
      outline?: string;
      actionItems?: unknown;
    };

    return {
      summary: parsed.summary?.trim() || "生成结果为空，请稍后重试。",
      outline: parsed.outline?.trim() || "未能生成报告提纲，请根据会议纪要继续整理。",
      actionItems: normalizeActionItems(parsed.actionItems)
    };
  } catch {
    // 兼容模型偶尔输出非 JSON 内容的情况。
  }

  const outlineHeading = "# 二、报告大纲";
  const altOutlineHeading = "# 二、报告提纲";
  const outlineStart = Math.max(cleanedText.indexOf(outlineHeading), cleanedText.indexOf(altOutlineHeading));

  if (outlineStart >= 0) {
    return {
      summary: cleanedText.slice(0, outlineStart).trim(),
      outline: cleanedText.slice(outlineStart).trim(),
      actionItems: []
    };
  }

  return {
    summary: cleanedText || "生成结果为空，请稍后重试。",
    outline: "未能自动拆分报告提纲，请在会议纪要中查看完整生成结果。",
    actionItems: []
  };
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

function providerErrorFromUnknown(error: unknown, fallbackMessage: string) {
  if (error instanceof ProviderError) {
    return error;
  }

  const errorObject = error as { message?: string };
  return new ProviderError(errorObject?.message || fallbackMessage, 500);
}
