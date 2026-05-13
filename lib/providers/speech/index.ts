import { ProviderError } from "../errors";
import { aliyunSpeechProvider } from "./aliyun";
import { assemblyAiSpeechProvider } from "./assemblyai";
import type { SpeechProvider } from "./types";

export function getSpeechProvider(): SpeechProvider {
  const providerName = process.env.SPEECH_PROVIDER || "aliyun";

  if (providerName === "aliyun") {
    return aliyunSpeechProvider;
  }

  if (providerName === "assemblyai") {
    return assemblyAiSpeechProvider;
  }

  throw new ProviderError(`暂不支持语音转写供应商：${providerName}`, 400);
}
