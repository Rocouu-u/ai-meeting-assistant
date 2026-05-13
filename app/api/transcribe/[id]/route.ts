import { NextResponse } from "next/server";
import { ProviderError } from "../../../../lib/providers/errors";
import { getSpeechProvider } from "../../../../lib/providers/speech";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const requestUrl = new URL(request.url);
  const transcribeMode = requestUrl.searchParams.get("mode");
  const diarizationEnabled = transcribeMode === "fast" ? false : true;

  if (!id) {
    return NextResponse.json(
      {
        ok: false,
        message: "缺少转写任务编号。"
      },
      { status: 400 }
    );
  }

  try {
    const provider = getSpeechProvider();
    const transcript = await provider.poll(id, { diarizationEnabled });

    return NextResponse.json({
      ok: true,
      status: transcript.status,
      rawStatus: transcript.rawStatus,
      message: transcript.message,
      transcript: transcript.transcript,
      elapsedMs: transcript.elapsedMs
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
        message: "查询转写结果失败，请检查网络或稍后再试。"
      },
      { status: 502 }
    );
  }
}
