import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ProviderError } from "../errors";
import type { SpeechPollOptions, SpeechPollResult, SpeechProvider, SpeechSubmitOptions } from "./types";
import { getDashScopeApiKey } from "../../runtime-config";

type UploadPolicyResponse = {
  data?: {
    policy?: string;
    signature?: string;
    upload_dir?: string;
    upload_host?: string;
    oss_access_key_id?: string;
    x_oss_object_acl?: string;
    x_oss_forbid_overwrite?: string;
  };
};

type SubmitTranscriptionResponse = {
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
    code?: string;
    message?: string;
  };
  message?: string;
};

type QueryTranscriptionResponse = {
  output?: {
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
    code?: string;
    message?: string;
    result?: {
      transcription_url?: string;
    };
    results?: Array<{
      transcription_url?: string;
      subtask_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
      code?: string;
      message?: string;
    }>;
  };
  message?: string;
};

type TranscriptionResultFile = {
  properties?: {
    channels?: number[];
  };
  transcripts?: Array<{
    channel_id?: number;
    speaker_id?: number;
    text?: string;
    sentences?: Array<{
      channel_id?: number;
      speaker_id?: number;
      sentence_id?: number;
      text?: string;
    }>;
  }>;
};

type OfficialOssConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpointHost: string;
  uploadHost: string;
  dir: string;
  expiresSeconds: number;
};

type MultipartUploadResponse = {
  ok: boolean;
  status: number;
  body: string;
};

type TaskTiming = {
  startedAt: number;
  submittedAt: number;
  uploadElapsedMs: number;
  submitElapsedMs: number;
  diarizationEnabled: boolean;
};

const dashScopeBaseUrl = "https://dashscope.aliyuncs.com/api/v1";
const uploadTimeoutMs = 8 * 60 * 1000;
const apiTimeoutMs = 60 * 1000;
const localFileUrlMessage = "当前转写接口需要可访问的音频地址，本地文件需先上传到可访问位置。";
const taskTimings = new Map<string, TaskTiming>();

export const aliyunSpeechProvider: SpeechProvider = {
  name: "aliyun",
  async submit(file, options) {
    const apiKey = getAliyunApiKey();
    const model = getAliyunAsrModel();
    const startedAt = Date.now();
    let audioUrl: string;

    try {
      audioUrl = await uploadAudioForAliyun(file, apiKey, model, options?.fileBuffer);
    } catch (error) {
      logAsrError("upload_failed", error, {
        fileType: file.type || "unknown",
        fileSize: file.size,
        model
      });
      throw error;
    }

    const submitStartedAt = Date.now();
    return submitAudioUrlToFunAsr(audioUrl, apiKey, model, startedAt, submitStartedAt - startedAt, options);
  },
  async submitAudioUrl(audioUrl, options) {
    const apiKey = getAliyunApiKey();
    const model = getAliyunAsrModel();
    const startedAt = Date.now();

    return submitAudioUrlToFunAsr(audioUrl, apiKey, model, startedAt, options?.uploadElapsedMs ?? 0, options);
  },
  async poll(transcriptId, options) {
    const apiKey = getAliyunApiKey();
    const pollStartedAt = Date.now();
    let response: Response;
    let result: QueryTranscriptionResponse;

    try {
      response = await fetchWithTimeout(`${dashScopeBaseUrl}/tasks/${transcriptId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable"
        }
      }, apiTimeoutMs);
      result = (await response.json()) as QueryTranscriptionResponse;
    } catch (error) {
      logAsrError("polling_failed", error, { taskId: redactTaskId(transcriptId) });
      throw error;
    }

    const pollElapsedMs = Date.now() - pollStartedAt;
    const rawStatus = result.output?.task_status;
    const mappedStatus = mapAliyunTaskStatus(rawStatus);
    const timing = taskTimings.get(transcriptId);
    const pollTotalElapsedMs = timing ? Date.now() - timing.submittedAt : undefined;
    const totalElapsedMs = timing ? Date.now() - timing.startedAt : undefined;

    if (!response.ok) {
      logAsrError("polling_failed", result, {
        status: response.status,
        code: result.output?.code,
        message: result.output?.message || result.message,
        taskId: redactTaskId(transcriptId),
        pollElapsedMs,
        pollTotalElapsedMs,
        totalElapsedMs
      });
      throw new ProviderError(
        formatAliyunErrorMessage(result.output?.message || result.output?.code || result.message),
        502
      );
    }

    const status = result.output?.task_status;
    const firstResult = result.output?.results?.find((item) => isAliyunCompleteStatus(item.subtask_status));
    const failedResult = result.output?.results?.find((item) => isAliyunFailedStatus(item.subtask_status));
    const transcriptionUrl = result.output?.result?.transcription_url ?? firstResult?.transcription_url;

    logAsrInfo("poll_result", {
      taskId: redactTaskId(transcriptId),
      rawStatus,
      mappedStatus,
      pollElapsedMs,
      pollTotalElapsedMs,
      totalElapsedMs,
      resultUrlPresent: Boolean(transcriptionUrl),
      resultCount: result.output?.results?.length ?? 0,
      succeededSubtasks: result.output?.results?.filter((item) => isAliyunCompleteStatus(item.subtask_status)).length ?? 0,
      failedSubtasks: result.output?.results?.filter((item) => isAliyunFailedStatus(item.subtask_status)).length ?? 0
    });

    if (isAliyunFailedStatus(status)) {
      logAsrError("polling_failed", result, {
        code: result.output?.code,
        message: result.output?.message,
        taskId: redactTaskId(transcriptId),
        rawStatus,
        pollElapsedMs,
        pollTotalElapsedMs,
        totalElapsedMs
      });
      taskTimings.delete(transcriptId);
      throw new ProviderError(formatAliyunErrorMessage(result.output?.message || result.output?.code), 502);
    }

    if (!isAliyunCompleteStatus(status)) {
      return {
        status: mappedStatus,
        message: "阿里云 Fun-ASR 正在转写中，请稍后。",
        rawStatus,
        elapsedMs: totalElapsedMs
      };
    }

    if (!transcriptionUrl) {
      logAsrError("polling_failed", result, {
        code: failedResult?.code,
        message: failedResult?.message,
        taskId: redactTaskId(transcriptId),
        rawStatus,
        pollElapsedMs,
        pollTotalElapsedMs,
        totalElapsedMs
      });
      throw new ProviderError(
        failedResult?.message || failedResult?.code || "阿里云 Fun-ASR 没有返回转写结果文件地址，请稍后再试。",
        502
      );
    }

    const parseStartedAt = Date.now();
    const transcript = await fetchTranscriptionText(transcriptionUrl, timing?.diarizationEnabled ?? getDiarizationEnabled(options));
    const parseElapsedMs = Date.now() - parseStartedAt;

    logAsrInfo("transcription_completed", {
      taskId: redactTaskId(transcriptId),
      rawStatus,
      pollElapsedMs,
      pollTotalElapsedMs,
      parseElapsedMs,
      totalElapsedMs: timing ? Date.now() - timing.startedAt : undefined,
      transcriptLength: transcript.length
    });
    logAsrInfo("funasr_done", {
      taskId: redactTaskId(transcriptId),
      rawStatus,
      pollTotalElapsedMs,
      parseElapsedMs,
      totalElapsedMs: timing ? Date.now() - timing.startedAt : undefined,
      transcriptLength: transcript.length
    });
    taskTimings.delete(transcriptId);

    return {
      status: "completed",
      message: "转写完成。",
      transcript,
      rawStatus,
      elapsedMs: timing ? Date.now() - timing.startedAt : undefined
    };
  }
};

async function submitAudioUrlToFunAsr(
  audioUrl: string,
  apiKey: string,
  model: string,
  startedAt: number,
  uploadElapsedMs: number,
  options?: SpeechSubmitOptions
) {
  let response: Response;
  let result: SubmitTranscriptionResponse;
  const submitStartedAt = Date.now();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-DashScope-Async": "enable"
  };

  if (audioUrl.startsWith("oss://")) {
    headers["X-DashScope-OssResourceResolve"] = "enable";
  }

  try {
    logAsrInfo("funasr_submit_start", {
      model,
      diarizationEnabled: getDiarizationEnabled(options),
      speakerCountConfigured: getSpeakerCountForLog(options),
      audioUrlType: audioUrl.startsWith("oss://") ? "dashscope_temp_oss" : "https_signed_url"
    });
    response = await fetchWithTimeout(`${dashScopeBaseUrl}/services/audio/asr/transcription`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: {
          file_urls: [audioUrl]
        },
        parameters: buildAsrParameters(options)
      })
    }, apiTimeoutMs);
    result = (await response.json()) as SubmitTranscriptionResponse;
  } catch (error) {
    logAsrError("submit_failed", error, { model });
    throw error;
  }

  const submitElapsedMs = Date.now() - submitStartedAt;

  if (!response.ok) {
    logAsrError("submit_failed", result, {
      status: response.status,
      code: result.output?.code,
      message: result.output?.message || result.message,
      model
    });
    throw new ProviderError(
      formatAliyunSubmitError(result.output?.message || result.output?.code || result.message),
      502
    );
  }

  const taskId = result.output?.task_id;

  if (!taskId) {
    logAsrError("submit_failed", result, {
      status: response.status,
      code: result.output?.code,
      message: result.output?.message || result.message,
      model
    });
    throw new ProviderError("阿里云 Fun-ASR 没有返回转写任务编号，请稍后再试。", 502);
  }

  taskTimings.set(taskId, {
    startedAt,
    submittedAt: Date.now(),
    uploadElapsedMs,
    submitElapsedMs,
    diarizationEnabled: getDiarizationEnabled(options)
  });
  logAsrInfo("submit_completed", {
    taskId: redactTaskId(taskId),
    rawStatus: result.output?.task_status,
    mappedStatus: mapAliyunTaskStatus(result.output?.task_status),
    uploadElapsedMs,
    submitElapsedMs,
    totalElapsedMs: Date.now() - startedAt,
    model,
    diarizationEnabled: getDiarizationEnabled(options),
    speakerCountConfigured: getSpeakerCountForLog(options)
  });
  logAsrInfo("funasr_submit_done", {
    taskId: redactTaskId(taskId),
    rawStatus: result.output?.task_status,
    elapsedMs: submitElapsedMs,
    totalElapsedMs: Date.now() - startedAt,
    model
  });

  return {
    status: mapAliyunTaskStatus(result.output?.task_status),
    transcriptId: taskId,
    message: "已提交到阿里云 Fun-ASR，正在等待转写结果。",
    rawStatus: result.output?.task_status
  };
}

async function uploadAudioForAliyun(file: File, apiKey: string, model: string, fileBuffer?: Buffer) {
  const officialOssConfig = isOfficialOssEnabled() ? getOfficialOssConfig() : null;

  if (officialOssConfig) {
    return uploadFileToOfficialOss(file, officialOssConfig, fileBuffer);
  }

  return uploadFileToDashScopeOss(file, apiKey, model, fileBuffer);
}

async function uploadFileToDashScopeOss(file: File, apiKey: string, model: string, fileBuffer?: Buffer) {
  const uploadStartedAt = Date.now();
  let policyResponse: Response;
  let policyResult: UploadPolicyResponse;

  try {
    policyResponse = await fetchWithTimeout(
      `${dashScopeBaseUrl}/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      },
      apiTimeoutMs
    );
    policyResult = (await policyResponse.json()) as UploadPolicyResponse;
  } catch (error) {
    logAsrError("upload_failed", error, { step: "get_policy", model });
    throw providerErrorFromUnknown(
      error,
      "获取阿里云临时上传凭证失败，请检查网络或稍后再试。"
    );
  }
  const policy = policyResult.data;

  if (!policyResponse.ok || !policy?.upload_host || !policy.upload_dir) {
    logAsrError("upload_failed", policyResult, {
      step: "get_policy",
      status: policyResponse.status,
      model
    });
    throw new ProviderError("获取阿里云临时上传凭证失败，请检查 API Key 或稍后再试。", 502);
  }

  const key = `${policy.upload_dir}/${Date.now()}-${sanitizeFileName(file.name)}`;
  let uploadResponse: MultipartUploadResponse;

  try {
    logAsrInfo("dashscope_temp_upload_start", {
      fileType: file.type || "unknown",
      fileSize: file.size,
      model
    });
    uploadResponse = await uploadMultipartFile(policy.upload_host, {
      OSSAccessKeyId: requiredField(policy.oss_access_key_id, "oss_access_key_id"),
      Signature: requiredField(policy.signature, "signature"),
      policy: requiredField(policy.policy, "policy"),
      key,
      "x-oss-object-acl": requiredField(policy.x_oss_object_acl, "x_oss_object_acl"),
      "x-oss-forbid-overwrite": requiredField(policy.x_oss_forbid_overwrite, "x_oss_forbid_overwrite"),
      success_action_status: "200"
    }, file, fileBuffer);
  } catch (error) {
    logAsrError("upload_failed", error, {
      step: "upload_dashscope_temp_file",
      fileType: file.type || "unknown",
      fileSize: file.size
    });
    throw providerErrorFromUnknown(
      error,
      "音频上传到阿里云临时存储失败或超时，请检查网络后重试，或先用较短的 mp3 / wav 测试。"
    );
  }

  if (!uploadResponse.ok) {
    logAsrError("upload_failed", undefined, {
      step: "upload_dashscope_temp_file",
      status: uploadResponse.status,
      fileType: file.type || "unknown",
      fileSize: file.size
    });
    throw new ProviderError("音频上传到阿里云临时存储失败，请稍后再试。", 502);
  }

  logAsrInfo("upload_completed", {
    step: "upload_dashscope_temp_file",
    elapsedMs: Date.now() - uploadStartedAt,
    fileType: file.type || "unknown",
    fileSize: file.size,
    model
  });
  logAsrInfo("dashscope_temp_upload_done", {
    elapsedMs: Date.now() - uploadStartedAt,
    fileType: file.type || "unknown",
    fileSize: file.size,
    model
  });

  return `oss://${key}`;
}

async function uploadFileToOfficialOss(file: File, config: OfficialOssConfig, fileBuffer?: Buffer) {
  const uploadStartedAt = Date.now();
  const objectKey = `${config.dir}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const expiresAt = new Date(Date.now() + config.expiresSeconds * 1000).toISOString();
  const maxFileSize = 1024 * 1024 * 1024;
  const policy = Buffer.from(
    JSON.stringify({
      expiration: expiresAt,
      conditions: [
        ["starts-with", "$key", config.dir],
        ["content-length-range", 0, maxFileSize]
      ]
    })
  ).toString("base64");
  const signature = createHmac("sha1", config.accessKeySecret).update(policy).digest("base64");

  let uploadResponse: MultipartUploadResponse;

  try {
    uploadResponse = await uploadMultipartFile(config.uploadHost, {
      OSSAccessKeyId: config.accessKeyId,
      Signature: signature,
      policy,
      key: objectKey,
      success_action_status: "200"
    }, file, fileBuffer);
  } catch (error) {
    logAsrError("upload_failed", error, {
      step: "upload_official_oss",
      fileType: file.type || "unknown",
      fileSize: file.size,
      bucket: config.bucket
    });
    throw providerErrorFromUnknown(
      error,
      "音频上传到正式阿里云 OSS 失败或超时，请检查 OSS 配置和网络后重试。"
    );
  }

  if (!uploadResponse.ok) {
    logAsrError("upload_failed", undefined, {
      step: "upload_official_oss",
      status: uploadResponse.status,
      fileType: file.type || "unknown",
      fileSize: file.size,
      bucket: config.bucket
    });
    throw new ProviderError("音频上传到正式阿里云 OSS 失败，请检查 OSS 权限和配置。", 502);
  }

  logAsrInfo("upload_completed", {
    step: "upload_official_oss",
    elapsedMs: Date.now() - uploadStartedAt,
    fileType: file.type || "unknown",
    fileSize: file.size,
    bucket: config.bucket
  });

  return createSignedOssUrl(config, objectKey);
}

async function fetchTranscriptionText(transcriptionUrl: string, expectSpeakerId: boolean) {
  let response: Response;

  try {
    response = await fetchWithTimeout(transcriptionUrl, {}, apiTimeoutMs);
  } catch (error) {
    logAsrError("parse_failed", error, { step: "download_result" });
    throw error;
  }

  if (!response.ok) {
    logAsrError("parse_failed", undefined, {
      step: "download_result",
      status: response.status
    });
    throw new ProviderError("下载阿里云 Fun-ASR 转写结果失败，请稍后再试。", 502);
  }

  let result: TranscriptionResultFile;

  try {
    result = (await response.json()) as TranscriptionResultFile;
  } catch (error) {
    logAsrError("parse_failed", error, { step: "parse_result_json" });
    throw new ProviderError("解析阿里云 Fun-ASR 转写结果失败，请稍后再试。", 502);
  }
  const transcript = formatAliyunTranscript(result, expectSpeakerId);

  if (!transcript) {
    logAsrError("parse_failed", undefined, {
      step: "empty_result",
      transcriptCount: result.transcripts?.length ?? 0
    });
    throw new ProviderError("阿里云 Fun-ASR 转写结果为空，请换一段音频重试。", 502);
  }

  return transcript;
}

function formatAliyunTranscript(result: TranscriptionResultFile, expectSpeakerId: boolean) {
  const transcripts = result.transcripts ?? [];
  const lines: string[] = [];
  const speakerMap = new Map<string, string>();
  let hasSpeakerId = false;

  transcripts.forEach((transcript, transcriptIndex) => {
    const sentences = transcript.sentences ?? [];

    if (sentences.length > 0) {
      sentences.forEach((sentence) => {
        if (sentence.text?.trim()) {
          hasSpeakerId = hasSpeakerId || sentence.speaker_id !== undefined || transcript.speaker_id !== undefined;
          if (!expectSpeakerId) {
            lines.push(sentence.text.trim());
            return;
          }
          const speakerName = getSpeakerName(sentence.speaker_id ?? transcript.speaker_id, speakerMap);
          lines.push(`${speakerName}：${sentence.text.trim()}`);
        }
      });
      return;
    }

    if (transcript.text?.trim()) {
      hasSpeakerId = hasSpeakerId || transcript.speaker_id !== undefined;
      if (!expectSpeakerId) {
        lines.push(transcript.text.trim());
        return;
      }
      const speakerName = getSpeakerName(transcript.speaker_id ?? transcript.channel_id ?? transcriptIndex, speakerMap);
      lines.push(`${speakerName}：${transcript.text.trim()}`);
    }
  });

  const transcriptText = lines.join("\n\n");

  if (transcriptText && expectSpeakerId && !hasSpeakerId) {
    return `当前识别结果未返回说话人分离信息，以下内容暂按发言人1显示。\n\n${transcriptText}`;
  }

  return transcriptText;
}

function getSpeakerName(speakerId: number | string | undefined, speakerMap: Map<string, string>) {
  const rawSpeaker = speakerId === undefined ? "unknown" : String(speakerId);

  if (!speakerMap.has(rawSpeaker)) {
    speakerMap.set(rawSpeaker, `发言人${speakerMap.size + 1}`);
  }

  return speakerMap.get(rawSpeaker) ?? "发言人1";
}

function getAliyunApiKey() {
  const apiKey = getDashScopeApiKey();

  if (!apiKey) {
    logAsrError("env_missing", undefined, {
      DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY ? "configured" : "missing",
      ALIYUN_API_KEY: process.env.ALIYUN_API_KEY ? "configured" : "missing"
    });
    throw new ProviderError("未检测到阿里云 API Key，请先在系统配置中填写 DASHSCOPE_API_KEY。", 400);
  }

  return apiKey;
}

function getAliyunAsrModel() {
  return process.env.ALIYUN_ASR_MODEL || "fun-asr";
}

function isOfficialOssEnabled() {
  return process.env.ALIYUN_OSS_ENABLED === "true";
}

function getOfficialOssConfig(): OfficialOssConfig | null {
  const bucket = process.env.ALIYUN_OSS_BUCKET;
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  const region = process.env.ALIYUN_OSS_REGION;
  const endpoint = process.env.ALIYUN_OSS_ENDPOINT;
  const hasAnyConfig = Boolean(bucket || accessKeyId || accessKeySecret || region || endpoint);

  if (!hasAnyConfig) {
    return null;
  }

  const missingFields = [
    ["ALIYUN_OSS_BUCKET", bucket],
    ["ALIYUN_OSS_ACCESS_KEY_ID", accessKeyId],
    ["ALIYUN_OSS_ACCESS_KEY_SECRET", accessKeySecret]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (!region && !endpoint) {
    missingFields.push("ALIYUN_OSS_REGION 或 ALIYUN_OSS_ENDPOINT");
  }

  if (missingFields.length > 0) {
    logAsrError("env_missing", undefined, {
      missingFields,
      ossConfigured: "partial"
    });
    throw new ProviderError(`阿里云 OSS 配置不完整，缺少：${missingFields.join("、")}。`, 400);
  }

  const endpointHost = normalizeOssEndpoint(endpoint || createOssEndpointFromRegion(region as string));
  const uploadHost = buildOssUploadHost(bucket as string, endpointHost);
  const dir = trimSlashes(process.env.ALIYUN_OSS_DIR || "meeting-audio");
  const expiresSeconds = Number(process.env.ALIYUN_OSS_EXPIRES_SECONDS || 6 * 60 * 60);

  return {
    accessKeyId: accessKeyId as string,
    accessKeySecret: accessKeySecret as string,
    bucket: bucket as string,
    endpointHost,
    uploadHost,
    dir,
    expiresSeconds: Number.isFinite(expiresSeconds) && expiresSeconds > 0 ? expiresSeconds : 6 * 60 * 60
  };
}

function buildAsrParameters(options?: SpeechSubmitOptions) {
  const parameters: {
    channel_id: number[];
    diarization_enabled: boolean;
    speaker_count?: number;
  } = {
    channel_id: [0],
    diarization_enabled: getDiarizationEnabled(options)
  };

  const speakerCount = Number(process.env.ALIYUN_ASR_SPEAKER_COUNT);

  if (parameters.diarization_enabled && Number.isInteger(speakerCount) && speakerCount >= 2 && speakerCount <= 100) {
    parameters.speaker_count = speakerCount;
  }

  return parameters;
}

function getDiarizationEnabled(options?: SpeechSubmitOptions) {
  if (typeof options?.diarizationEnabled === "boolean") {
    return options.diarizationEnabled;
  }

  return process.env.ALIYUN_ASR_DIARIZATION_ENABLED !== "false";
}

function mapAliyunTaskStatus(status?: string): SpeechPollResult["status"] {
  if (isAliyunCompleteStatus(status)) {
    return "completed";
  }

  if (isAliyunFailedStatus(status)) {
    return "error";
  }

  if (normalizeAliyunStatus(status) === "PENDING") {
    return "queued";
  }

  return "processing";
}

function isAliyunCompleteStatus(status?: string) {
  const normalizedStatus = normalizeAliyunStatus(status);
  return normalizedStatus === "SUCCEEDED" || normalizedStatus === "SUCCESS" || normalizedStatus === "COMPLETED";
}

function isAliyunFailedStatus(status?: string) {
  const normalizedStatus = normalizeAliyunStatus(status);
  return (
    normalizedStatus === "FAILED" ||
    normalizedStatus === "FAIL" ||
    normalizedStatus === "ERROR" ||
    normalizedStatus === "UNKNOWN" ||
    normalizedStatus === "CANCELED" ||
    normalizedStatus === "CANCELLED"
  );
}

function normalizeAliyunStatus(status?: string) {
  return status?.trim().toUpperCase();
}

function requiredField(value: string | undefined, fieldName: string) {
  if (!value) {
    throw new ProviderError(`阿里云上传凭证缺少 ${fieldName}，请稍后再试。`, 502);
  }

  return value;
}

function sanitizeFileName(fileName: string) {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "audio-file";
}

function formatAliyunErrorMessage(message?: string) {
  if (
    message === "SUCCESS_WITH_NO_VALID_FRAGMENT" ||
    message === "ASR_RESPONSE_HAVE_NO_WORDS" ||
    message?.toLowerCase().includes("no words") ||
    message?.toLowerCase().includes("no valid fragment")
  ) {
    return "音频中没有识别到有效语音，请换一段清晰的会议录音重试。";
  }

  if (
    message?.toLowerCase().includes("url") ||
    message?.toLowerCase().includes("not accessible") ||
    message?.includes("下载") ||
    message?.includes("访问")
  ) {
    return localFileUrlMessage;
  }

  if (message?.toLowerCase().includes("format") || message?.includes("格式")) {
    return "音频格式暂不支持，请尝试 mp3 或 wav。";
  }

  return message || "阿里云 Fun-ASR 转写失败。";
}

function formatAliyunSubmitError(message?: string) {
  if (!message) {
    return "阿里云 Fun-ASR 创建转写任务失败，请检查 API Key 或音频文件。";
  }

  if (message.toLowerCase().includes("url") || message.includes("下载") || message.includes("访问")) {
    return localFileUrlMessage;
  }

  if (message.toLowerCase().includes("format") || message.includes("格式")) {
    return "音频格式暂不支持，请尝试 mp3 或 wav。";
  }

  return message;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logAsrError("timeout", undefined, {
        timeoutMs,
        urlHost: getUrlHost(input)
      });
      throw new ProviderError("转写任务仍在处理中，请稍后重试或缩短音频测试。", 504);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function logAsrError(stage: string, error?: unknown, details: Record<string, unknown> = {}) {
  const errorObject = error as {
    output?: {
      code?: string;
      message?: string;
    };
    code?: string;
    message?: string;
    name?: string;
  };

  console.error(
    "Aliyun Fun-ASR error",
    JSON.stringify({
      stage,
      code: errorObject?.output?.code ?? errorObject?.code,
      message: errorObject?.output?.message ?? errorObject?.message,
      errorName: errorObject?.name,
      ...details
    })
  );
}

function logAsrInfo(stage: string, details: Record<string, unknown> = {}) {
  console.info(
    "Aliyun Fun-ASR info",
    JSON.stringify({
      stage,
      ...details
    })
  );
}

function providerErrorFromUnknown(error: unknown, fallbackMessage: string) {
  if (error instanceof ProviderError) {
    return error;
  }

  const errorObject = error as {
    code?: string;
    cause?: {
      code?: string;
    };
  };

  if (
    errorObject?.code === "UND_ERR_HEADERS_TIMEOUT" ||
    errorObject?.code === "UPLOAD_TIMEOUT" ||
    errorObject?.cause?.code === "UND_ERR_HEADERS_TIMEOUT"
  ) {
    return new ProviderError("音频上传到阿里云存储超时，请检查网络后重试，或先用较短的 mp3 / wav 测试。", 504);
  }

  return new ProviderError(fallbackMessage, 502);
}

function getSpeakerCountForLog(options?: SpeechSubmitOptions) {
  if (!getDiarizationEnabled(options)) {
    return "disabled";
  }

  const speakerCount = Number(process.env.ALIYUN_ASR_SPEAKER_COUNT);
  return Number.isInteger(speakerCount) && speakerCount >= 2 && speakerCount <= 100 ? speakerCount : "auto";
}

async function uploadMultipartFile(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  reusableFileBuffer?: Buffer
): Promise<MultipartUploadResponse> {
  const boundary = `----meeting-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  Object.entries(fields).forEach(([name, value]) => {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeMultipartName(name)}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  });

  const fileBuffer = reusableFileBuffer ?? Buffer.from(await file.arrayBuffer());
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="file"; filename="${escapeMultipartName(file.name)}"\r\n` +
        `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`
    )
  );
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);

  return requestBuffer(uploadUrl, body, {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(body.length)
  });
}

function requestBuffer(url: string, body: Buffer, headers: Record<string, string>) {
  return new Promise<MultipartUploadResponse>((resolve, reject) => {
    const targetUrl = new URL(url);
    const requestFactory = targetUrl.protocol === "http:" ? httpRequest : httpsRequest;
    const request = requestFactory(
      targetUrl,
      {
        method: "POST",
        headers,
        timeout: uploadTimeoutMs
      },
      (response) => {
        const responseChunks: Buffer[] = [];

        response.on("data", (chunk) => {
          responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(responseChunks).toString("utf8")
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(Object.assign(new Error("Upload request timeout"), { code: "UPLOAD_TIMEOUT" }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function createSignedOssUrl(config: OfficialOssConfig, objectKey: string) {
  const expires = Math.floor(Date.now() / 1000) + config.expiresSeconds;
  const canonicalResource = `/${config.bucket}/${objectKey}`;
  const stringToSign = `GET\n\n\n${expires}\n${canonicalResource}`;
  const signature = createHmac("sha1", config.accessKeySecret).update(stringToSign).digest("base64");
  const params = new URLSearchParams({
    OSSAccessKeyId: config.accessKeyId,
    Expires: String(expires),
    Signature: signature
  });

  return `${config.uploadHost}/${encodeOssObjectKey(objectKey)}?${params.toString()}`;
}

function normalizeOssEndpoint(endpoint: string) {
  return endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function createOssEndpointFromRegion(region: string) {
  const normalizedRegion = region.replace(/^oss-/, "");
  return `oss-${normalizedRegion}.aliyuncs.com`;
}

function buildOssUploadHost(bucket: string, endpointHost: string) {
  const host = endpointHost.startsWith(`${bucket}.`) ? endpointHost : `${bucket}.${endpointHost}`;
  return `https://${host}`;
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "") || "meeting-audio";
}

function escapeMultipartName(value: string) {
  return value.replace(/["\r\n]/g, "_");
}

function encodeOssObjectKey(objectKey: string) {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

function redactTaskId(taskId: string) {
  if (taskId.length <= 8) {
    return "configured";
  }

  return `${taskId.slice(0, 4)}...${taskId.slice(-4)}`;
}

function getUrlHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
