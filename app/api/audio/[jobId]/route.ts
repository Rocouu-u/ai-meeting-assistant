import { NextResponse } from "next/server";
import { createReadStream, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  // Basic safety: jobId must be a UUID-like string, no path traversal
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(jobId)) {
    return NextResponse.json({ ok: false, message: "无效的 jobId" }, { status: 400 });
  }

  const wavPath = join(process.cwd(), "storage", "local-transcribe-jobs", jobId, "input.wav");

  if (!existsSync(wavPath)) {
    return NextResponse.json({ ok: false, message: "音频文件不存在" }, { status: 404 });
  }

  const stat = statSync(wavPath);
  const fileSize = stat.size;

  const range = _request.headers.get("range");

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = createReadStream(wavPath, { start, end });
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": "audio/wav",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = createReadStream(wavPath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
