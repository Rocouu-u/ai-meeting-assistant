import {
  assemblyAiBaseUrl,
  formatAssemblyAiTranscript,
  type AssemblyAiTranscriptResponse
} from "../../assemblyai";
import { ProviderError } from "../errors";
import type { SpeechProvider } from "./types";

export const assemblyAiSpeechProvider: SpeechProvider = {
  name: "assemblyai",
  async submit(file) {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      throw new ProviderError("还没有配置 AssemblyAI API Key。AssemblyAI 现在只是海外备选方案。", 400);
    }

    const uploadResponse = await fetch(`${assemblyAiBaseUrl}/v2/upload`, {
      method: "POST",
      headers: {
        Authorization: apiKey
      },
      body: file
    });

    if (!uploadResponse.ok) {
      throw new ProviderError("音频上传到 AssemblyAI 失败，请检查 API Key 或稍后再试。", 502);
    }

    const uploadResult = (await uploadResponse.json()) as { upload_url?: string };

    if (!uploadResult.upload_url) {
      throw new ProviderError("AssemblyAI 没有返回音频地址，请稍后再试。", 502);
    }

    const transcriptResponse = await fetch(`${assemblyAiBaseUrl}/v2/transcript`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audio_url: uploadResult.upload_url,
        language_code: "zh",
        speaker_labels: true,
        punctuate: true,
        format_text: true,
        speech_models: ["universal-3-pro", "universal-2"]
      })
    });

    if (!transcriptResponse.ok) {
      throw new ProviderError("创建 AssemblyAI 转写任务失败，请检查音频文件或 API Key。", 502);
    }

    const transcriptResult = (await transcriptResponse.json()) as {
      id?: string;
      status?: "queued" | "processing" | "completed" | "error";
    };

    if (!transcriptResult.id) {
      throw new ProviderError("AssemblyAI 没有返回转写任务编号，请稍后再试。", 502);
    }

    return {
      status: transcriptResult.status ?? "queued",
      transcriptId: transcriptResult.id,
      message: "已提交到 AssemblyAI，正在等待转写结果。"
    };
  },
  async submitAudioUrl() {
    throw new ProviderError("AssemblyAI 备用方案暂不支持 OSS 直传 URL 提交。", 400);
  },
  async poll(transcriptId) {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      throw new ProviderError("还没有配置 AssemblyAI API Key。AssemblyAI 现在只是海外备选方案。", 400);
    }

    const response = await fetch(`${assemblyAiBaseUrl}/v2/transcript/${transcriptId}`, {
      headers: {
        Authorization: apiKey
      }
    });

    if (!response.ok) {
      throw new ProviderError("查询 AssemblyAI 转写结果失败，请稍后再试。", 502);
    }

    const transcript = (await response.json()) as AssemblyAiTranscriptResponse;

    if (transcript.status === "error") {
      throw new ProviderError(transcript.error ?? "AssemblyAI 转写失败。", 502);
    }

    if (transcript.status !== "completed") {
      return {
        status: transcript.status ?? "processing",
        message: "AssemblyAI 正在转写中，请稍后。"
      };
    }

    return {
      status: "completed",
      message: "转写完成。",
      transcript: formatAssemblyAiTranscript(transcript)
    };
  }
};
