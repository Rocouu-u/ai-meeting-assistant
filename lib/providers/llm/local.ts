import { join } from "node:path";
import { spawn } from "node:child_process";
import { ProviderError } from "../errors";
import { buildMeetingSummaryPrompt } from "../../prompts/meeting-summary";
import type { ActionItem, LlmProvider } from "./types";

const LLM_SERVER_PORT = parseInt(process.env.LOCAL_LLM_SERVER_PORT || "18321", 10);
const LLM_SERVER_URL = `http://127.0.0.1:${LLM_SERVER_PORT}`;

let serverStarting = false;
let serverReady = false;

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

async function runLocalSummaryModel(promptText: string): Promise<string> {
  await ensureServerRunning();

  try {
    const res = await fetch(`${LLM_SERVER_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText }),
      // @ts-ignore
      signal: AbortSignal.timeout(600_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `服务器返回 ${res.status}`);
    }

    const data = await res.json() as { text?: string };
    return data.text?.trim() || "";
  } catch (error) {
    throw providerErrorFromUnknown(error, "本地会议纪要生成失败，请检查 Python 和 Qwen 本地模型环境。");
  }
}

async function ensureServerRunning(): Promise<void> {
  // 已就绪，直接用
  if (serverReady) {
    try {
      const r = await fetch(`${LLM_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      serverReady = false;
    }
  }

  // 等待其他调用者启动完成
  if (serverStarting) {
    await waitForServer(120_000);
    return;
  }

  // 检查服务器是否已经在跑（手动启动的情况）
  try {
    const r = await fetch(`${LLM_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      serverReady = true;
      return;
    }
  } catch {
    // 还没起来，需要启动
  }

  serverStarting = true;
  startServer();
  await waitForServer(300_000); // 等最多 5 分钟（首次加载模型）
  serverStarting = false;
  serverReady = true;
}

function startServer(): void {
  const pythonCommand = process.env.LOCAL_PYTHON_PATH || "python3";
  const scriptPath = join(process.cwd(), "scripts", "local-summary-server.py");

  const child = spawn(pythonCommand, [scriptPath], {
    cwd: process.cwd(),
    stdio: "ignore",
    detached: false,
    env: { ...process.env },
  });

  child.on("error", (err) => {
    console.error("[LLM server] 启动失败:", err.message);
    serverStarting = false;
    serverReady = false;
  });

  child.on("exit", (code) => {
    console.warn("[LLM server] 进程退出，code:", code);
    serverReady = false;
  });
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${LLM_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      // 还没好
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new ProviderError("本地 LLM 服务启动超时，请检查 Python 环境和模型是否正确安装。", 500);
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
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeActionItem(item))
    .filter((item): item is ActionItem => Boolean(item));
}

function normalizeActionItem(value: unknown): ActionItem | null {
  if (!value || typeof value !== "object") return null;

  const item = value as Record<string, unknown>;
  const topic = textValue(item.topic) || textValue(item["议题"]);
  const expectedResult =
    textValue(item.expectedResult) ||
    textValue(item["预期结果"]) ||
    textValue(item.action) ||
    textValue(item["行动项"]);

  return {
    topic: topic || "未明确",
    owner: textValue(item.owner) || textValue(item["责任人"]) || "未分配",
    expectedResult: expectedResult || "未明确",
    deadline: textValue(item.deadline) || textValue(item.dueDate) || textValue(item["截止时间"]) || "TBD",
    sourceTimestamp:
      textValue(item.sourceTimestamp) ||
      textValue(item["溯源时间戳"]) ||
      textValue(item["来源时间戳"]) ||
      "未明确"
  };
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerErrorFromUnknown(error: unknown, fallbackMessage: string) {
  if (error instanceof ProviderError) return error;
  const errorObject = error as { message?: string };
  return new ProviderError(errorObject?.message || fallbackMessage, 500);
}
