import { NextResponse } from "next/server";

type ClientLogRequest = {
  stage?: string;
  elapsedMs?: number;
  fileType?: string;
  fileSize?: number;
  progress?: number;
  loaded?: number;
  total?: number;
  message?: string;
};

export async function POST(request: Request) {
  let body: ClientLogRequest;

  try {
    body = (await request.json()) as ClientLogRequest;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  console.info(
    "Client timing info",
    JSON.stringify({
      stage: body.stage || "unknown",
      elapsedMs: body.elapsedMs,
      fileType: body.fileType,
      fileSize: body.fileSize,
      progress: body.progress,
      loaded: body.loaded,
      total: body.total,
      message: body.message
    })
  );

  return NextResponse.json({ ok: true });
}
