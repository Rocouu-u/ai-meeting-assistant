import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import bundledFfmpegPath from "ffmpeg-static";
import { ProviderError } from "../errors";
import type {
  SpeechPollOptions,
  SpeechPollResult,
  SpeechProvider,
  SpeechSubmitOptions,
  SpeechSubmitResult,
  TranscriptSegment
} from "./types";
import { getWritableDataDir } from "../../storage-paths";

type LocalJobStatus =
  | {
      status: "processing";
      message: string;
    }
  | {
      status: "completed";
      message: string;
      transcript: string;
      segments?: TranscriptSegment[];
      rawStatus?: string;
    }
  | {
      status: "failed";
      message: string;
    };

const jobRootDir = join(getWritableDataDir(), "local-transcribe-jobs");
const jobTimeoutMs = 3 * 60 * 60 * 1000;

export const localSpeechProvider: SpeechProvider = {
  name: "local",
  async submit(file, options) {
    return submitLocalJob(file, options);
  },
  async submitAudioUrl(audioUrl, options) {
    const response = await fetch(audioUrl);

    if (!response.ok) {
      throw new ProviderError("下载本地音频失败，请检查文件地址是否可访问。", 502);
    }

    const fileBuffer = Buffer.from(await response.arrayBuffer());
    const fileName = options?.sourceFileName || basename(new URL(audioUrl).pathname) || "meeting-audio.wav";
    const fileType = options?.sourceFileType || response.headers.get("content-type") || "application/octet-stream";
    const file = new File([new Uint8Array(fileBuffer)], fileName, { type: fileType });

    return submitLocalJob(file, {
      ...options,
      fileBuffer
    });
  },
  async poll(transcriptId, _options) {
    const status = await readJobStatus(transcriptId);

    if (!status) {
      return {
        status: "processing",
        message: "本地识别任务正在处理中，请稍后。"
      };
    }

    if (status.status === "failed") {
      throw new ProviderError(status.message, 502);
    }

    if (status.status === "processing") {
      return {
        status: "processing",
        message: status.message
      };
    }

    return {
      status: "completed",
      message: status.message,
      transcript: status.transcript,
      rawStatus: status.rawStatus,
      segments: status.segments
    };
  }
};

async function submitLocalJob(file: File, options?: SpeechSubmitOptions): Promise<SpeechSubmitResult> {
  const jobId = randomUUID();
  const jobDir = join(jobRootDir, jobId);
  const statusPath = join(jobDir, "status.json");
  const inputPath = join(jobDir, "input.wav");
  const sourceBuffer = options?.fileBuffer ?? Buffer.from(await file.arrayBuffer());
  const startedAt = Date.now();

  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, "source.meta.json"), JSON.stringify({
    sourceFileName: file.name,
    sourceFileType: file.type || "application/octet-stream",
    sourceFileSize: file.size,
    diarizationEnabled: getDiarizationEnabled(options)
  }, null, 2));

  const monoBuffer = await convertToMonoWav(file.name, file.type || "application/octet-stream", sourceBuffer);
  await writeFile(inputPath, monoBuffer);
  await writeJobStatus(statusPath, {
    status: "processing",
    message: "本地识别任务已提交，正在处理中。"
  });
  spawnWorker(jobId, inputPath, statusPath, getDiarizationEnabled(options));

  return {
    status: "processing",
    transcriptId: jobId,
    message: "已提交到本地识别引擎，正在等待识别结果。"
  };
}

function spawnWorker(jobId: string, inputPath: string, statusPath: string, diarizationEnabled: boolean) {
  const pythonCommand = getPythonCommand();
  const scriptPath = join(process.cwd(), "scripts", "local-transcribe-job.py");
  const args = [scriptPath, inputPath, statusPath, diarizationEnabled ? "1" : "0"];

  const child = spawn(pythonCommand, args, {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      LOCAL_TRANSCRIBE_JOB_ID: jobId,
      LOCAL_TRANSCRIBE_JOB_TIMEOUT_MS: String(jobTimeoutMs)
    }
  });

  child.on("error", async (error) => {
    await writeJobStatus(statusPath, {
      status: "failed",
      message: error.message || "本地识别任务启动失败。"
    });
  });

  child.on("exit", async (code, signal) => {
    if (code === 0) {
      return;
    }

    await writeJobStatus(statusPath, {
      status: "failed",
      message: signal
        ? `本地识别任务被中断：${signal}`
        : `本地识别任务失败，退出码 ${code ?? "unknown"}。`
    });
  });

  child.unref();
}

async function readJobStatus(transcriptId: string): Promise<LocalJobStatus | null> {
  try {
    const statusPath = join(jobRootDir, transcriptId, "status.json");
    const raw = await readFile(statusPath, "utf-8");
    return JSON.parse(raw) as LocalJobStatus;
  } catch {
    return null;
  }
}

async function writeJobStatus(statusPath: string, status: LocalJobStatus) {
  await mkdir(join(statusPath, ".."), { recursive: true });
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf-8");
}

async function convertToMonoWav(fileName: string, fileType: string, sourceBuffer: Buffer) {
  if (!getFfmpegExecutablePath()) {
    throw new ProviderError("缺少音频处理工具，无法进行本地转写。", 500);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "meeting-ai-local-asr-"));
  const inputPath = join(tempDir, `input${getAudioInputExtension(fileName, fileType)}`);
  const outputPath = join(tempDir, "mono.wav");

  try {
    await writeFile(inputPath, sourceBuffer);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      outputPath
    ]);

    return await readFile(outputPath);
  } catch (error) {
    throw providerErrorFromUnknown(error, "音频预处理失败，请换一段录音重试。");
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(args: string[]) {
  const executablePath = getFfmpegExecutablePath();

  if (!executablePath) {
    throw new ProviderError("缺少音频处理工具，无法进行本地转写。", 500);
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      stdio: "ignore"
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ProviderError("音频预处理超时，请换一段更短的录音重试。", 500));
    }, 15 * 60 * 1000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      reject(new ProviderError("音频预处理失败，请换一段录音重试。", 500));
    });
  });
}

function getFfmpegExecutablePath() {
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    bundledFfmpegPath,
    join(process.cwd(), "node_modules", "ffmpeg-static", executableName),
    join(process.cwd(), "vendor", "ffmpeg", executableName)
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getAudioInputExtension(fileName: string, fileType: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".mp3")) return ".mp3";
  if (lowerName.endsWith(".wav")) return ".wav";
  if (lowerName.endsWith(".m4a")) return ".m4a";
  if (lowerName.endsWith(".mp4")) return ".mp4";
  if (fileType.includes("wav")) return ".wav";
  if (fileType.includes("mpeg")) return ".mp3";
  return extname(lowerName) || ".wav";
}

function getDiarizationEnabled(options?: SpeechSubmitOptions) {
  return options?.diarizationEnabled ?? true;
}

function getPythonCommand() {
  return process.env.LOCAL_PYTHON_PATH || process.env.MODELSCOPE_PYTHON_PATH || "python3";
}

function providerErrorFromUnknown(error: unknown, fallbackMessage: string) {
  if (error instanceof ProviderError) {
    return error;
  }

  const errorObject = error as { message?: string };
  return new ProviderError(errorObject?.message || fallbackMessage, 500);
}
