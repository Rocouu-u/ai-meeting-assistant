import { NextResponse } from "next/server";
import { getQwenConfig } from "../../../../lib/runtime-config";

export const runtime = "nodejs";

type DashScopeErrorResponse = {
  error?: {
    message?: string;
  };
  message?: string;
};

export async function POST() {
  const { apiKey, baseUrl, model } = getQwenConfig();

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        message: "未检测到 DASHSCOPE_API_KEY，请先保存百炼 API Key。"
      },
      { status: 400 }
    );
  }

  try {
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
            role: "user",
            content: "请回复：ok"
          }
        ],
        max_tokens: 8,
        temperature: 0
      })
    });
    const result = (await response.json()) as DashScopeErrorResponse;

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: result.error?.message || result.message || "百炼 API 连接失败，请检查 API Key 或模型权限。"
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "百炼 API 连接成功。"
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "百炼 API 连接失败，请检查网络。"
      },
      { status: 502 }
    );
  }
}
