import { NextResponse } from "next/server";
import { ProviderError } from "../../../lib/providers/errors";
import { getLlmProvider } from "../../../lib/providers/llm";

type GenerateReportRequest = {
  transcript?: string;
};

export async function POST(request: Request) {
  let body: GenerateReportRequest;

  try {
    body = (await request.json()) as GenerateReportRequest;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "请求格式不正确，请先准备转写文本。"
      },
      { status: 400 }
    );
  }

  const transcript = body.transcript?.trim();

  if (!transcript) {
    return NextResponse.json(
      {
        ok: false,
        message: "转写文本为空，无法生成会议纪要和报告提纲。"
      },
      { status: 400 }
    );
  }

  try {
    const startedAt = Date.now();
    const provider = getLlmProvider();
    const result = await provider.generateMeetingReport({ transcript });
    console.info(
      "Generate report info",
      JSON.stringify({
        stage: "summary_done",
        elapsedMs: Date.now() - startedAt,
        transcriptLength: transcript.length,
        summaryLength: result.summary.length,
        outlineLength: result.outline.length
      })
    );

    return NextResponse.json({
      ok: true,
      message: result.message,
      summary: result.summary,
      outline: result.outline
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message
        },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        message: "生成会议纪要和报告提纲失败，请检查网络或稍后再试。"
      },
      { status: 502 }
    );
  }
}
