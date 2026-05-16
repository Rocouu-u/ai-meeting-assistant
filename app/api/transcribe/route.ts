import { NextResponse } from "next/server";
import { ProviderError } from "../../../lib/providers/errors";
import { getSpeechProvider } from "../../../lib/providers/speech";

const supportedExtensions = [".mp3", ".wav", ".m4a", ".mp4"];

export const runtime = "nodejs";

export async function POST(request: Request) {
  const browserUploadStartedAt = Date.now();
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "请求格式不正确。请从页面选择文件后再开始转写。"
      },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const audioUrl = formData.get("audioUrl");
  const directUploadElapsedMs = Number(formData.get("directUploadElapsedMs") || 0);
  const transcribeMode = formData.get("transcribeMode");
  const diarizationEnabled = transcribeMode === "fast" ? false : true;

  if (typeof audioUrl === "string" && audioUrl.startsWith("https://")) {
    try {
      const provider = getSpeechProvider();
      const transcriptResult = await provider.submitAudioUrl(audioUrl, {
        diarizationEnabled,
        sourceFileName: String(formData.get("fileName") || "OSS 音频文件"),
        sourceFileType: String(formData.get("fileType") || ""),
        uploadElapsedMs: Number.isFinite(directUploadElapsedMs) ? directUploadElapsedMs : 0
      });

      return NextResponse.json({
        ok: true,
        status: transcriptResult.status,
        rawStatus: transcriptResult.rawStatus,
        transcriptId: transcriptResult.transcriptId,
        message: transcriptResult.message,
        transcript: transcriptResult.transcript,
        segments: transcriptResult.segments,
        transcribeMode: transcribeMode === "fast" ? "fast" : "standard",
        file: {
          name: String(formData.get("fileName") || "OSS 音频文件"),
          size: Number(formData.get("fileSize") || 0),
          type: String(formData.get("fileType") || "未知类型")
        }
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

      console.error("Transcribe provider error", error);

      return NextResponse.json(
        {
          ok: false,
          message: "转写服务连接失败，请检查网络或稍后再试。"
        },
        { status: 502 }
      );
    }
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        ok: false,
        message: "没有收到音频文件。请先在页面选择 mp3、wav、m4a 或 mp4 文件。"
      },
      { status: 400 }
    );
  }

  const fileName = file.name.toLowerCase();
  const isSupportedFile = supportedExtensions.some((extension) => fileName.endsWith(extension));

  if (!isSupportedFile) {
    return NextResponse.json(
      {
        ok: false,
        message: "音频格式暂不支持，请尝试 mp3 或 wav。"
      },
      { status: 400 }
    );
  }

  logTranscribeInfo("browser_to_backend_upload_done", {
    elapsedMs: Date.now() - browserUploadStartedAt,
    fileType: file.type || "unknown",
    fileSize: file.size
  });

  let audioBuffer: Buffer;

  try {
    audioBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "读取音频文件失败，请稍后再试。"
      },
      { status: 500 }
    );
  }

  try {
    const provider = getSpeechProvider();
    const transcriptResult = await provider.submit(file, { diarizationEnabled, fileBuffer: audioBuffer });

    return NextResponse.json({
      ok: true,
      status: transcriptResult.status,
      rawStatus: transcriptResult.rawStatus,
      transcriptId: transcriptResult.transcriptId,
      message: transcriptResult.message,
      transcript: transcriptResult.transcript,
      segments: transcriptResult.segments,
      transcribeMode: transcribeMode === "fast" ? "fast" : "standard",
      file: {
        name: file.name,
        size: file.size,
        type: file.type || "未知类型"
      }
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

    console.error("Transcribe provider error", error);

    return NextResponse.json(
      {
        ok: false,
        message: "转写服务连接失败，请检查网络或稍后再试。"
      },
      { status: 502 }
    );
  }
}

function logTranscribeInfo(stage: string, details: Record<string, unknown> = {}) {
  console.info(
    "Transcribe route info",
    JSON.stringify({
      stage,
      ...details
    })
  );
}
