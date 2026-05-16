import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getWritableDataDir, getWritableDataPath } from "./storage-paths";

export type RuntimeConfig = {
  dashscopeApiKey?: string;
  ossEnabled?: boolean;
  ossRegion?: string;
  ossBucket?: string;
  ossAccessKeyId?: string;
  ossAccessKeySecret?: string;
};

export type PublicRuntimeConfig = {
  dashscopeApiKeyConfigured: boolean;
  dashscopeApiKeySaved: boolean;
  dashscopeApiKeyMasked: string;
  ossEnabled: boolean;
  ossRegion: string;
  ossBucket: string;
  ossConfigured: boolean;
  ossAccessKeyIdConfigured: boolean;
  ossAccessKeyIdSaved: boolean;
  ossAccessKeyIdMasked: string;
  ossAccessKeySecretConfigured: boolean;
  ossAccessKeySecretSaved: boolean;
  ossAccessKeySecretMasked: string;
  usingEnvFallback: boolean;
  setupComplete: boolean;
};

const storageDir = getWritableDataDir();
const configPath = getWritableDataPath("config.json");
const defaultOssRegion = "oss-cn-hangzhou";

export function readRuntimeConfig(): RuntimeConfig {
  let fileConfig: RuntimeConfig = {};

  try {
    fileConfig = JSON.parse(readFileSync(configPath, "utf8")) as RuntimeConfig;
  } catch {
    fileConfig = {};
  }

  return {
    dashscopeApiKey: fileConfig.dashscopeApiKey || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || process.env.ALIYUN_API_KEY,
    ossEnabled: fileConfig.ossEnabled ?? process.env.OSS_ENABLED === "true",
    ossRegion: fileConfig.ossRegion || process.env.OSS_REGION || defaultOssRegion,
    ossBucket: fileConfig.ossBucket || process.env.OSS_BUCKET || "",
    ossAccessKeyId: fileConfig.ossAccessKeyId || process.env.OSS_ACCESS_KEY_ID || "",
    ossAccessKeySecret: fileConfig.ossAccessKeySecret || process.env.OSS_ACCESS_KEY_SECRET || ""
  };
}

export function readStoredRuntimeConfig(): RuntimeConfig {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as RuntimeConfig;
  } catch {
    return {};
  }
}

export function saveRuntimeConfig(input: RuntimeConfig) {
  mkdirSync(storageDir, { recursive: true });

  const previousConfig = readStoredRuntimeConfig();
  const nextConfig: RuntimeConfig = {
    dashscopeApiKey: input.dashscopeApiKey || previousConfig.dashscopeApiKey || "",
    ossEnabled: input.ossEnabled ?? previousConfig.ossEnabled ?? true,
    ossRegion: input.ossRegion || previousConfig.ossRegion || defaultOssRegion,
    ossBucket: input.ossBucket ?? previousConfig.ossBucket ?? "",
    ossAccessKeyId: input.ossAccessKeyId || previousConfig.ossAccessKeyId || "",
    ossAccessKeySecret: input.ossAccessKeySecret || previousConfig.ossAccessKeySecret || ""
  };

  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return readPublicRuntimeConfig();
}

export function readPublicRuntimeConfig(): PublicRuntimeConfig {
  const storedConfig = readStoredRuntimeConfig();
  const effectiveConfig = readRuntimeConfig();
  const storedOssEnabled = storedConfig.ossEnabled ?? true;
  const effectiveOssEnabled = effectiveConfig.ossEnabled ?? true;
  const dashscopeApiKeySaved = Boolean(storedConfig.dashscopeApiKey);
  const dashscopeApiKeyConfigured = Boolean(effectiveConfig.dashscopeApiKey);
  const ossAccessKeyIdSaved = Boolean(storedConfig.ossAccessKeyId);
  const ossAccessKeySecretSaved = Boolean(storedConfig.ossAccessKeySecret);
  const ossAccessKeyIdConfigured = Boolean(effectiveConfig.ossAccessKeyId);
  const ossAccessKeySecretConfigured = Boolean(effectiveConfig.ossAccessKeySecret);
  const storedOssComplete =
    !storedOssEnabled ||
    Boolean(storedConfig.ossBucket && storedConfig.ossRegion && storedConfig.ossAccessKeyId && storedConfig.ossAccessKeySecret);
  const effectiveOssComplete =
    !effectiveOssEnabled ||
    Boolean(
      effectiveConfig.ossBucket &&
        effectiveConfig.ossRegion &&
        effectiveConfig.ossAccessKeyId &&
        effectiveConfig.ossAccessKeySecret
    );
  const usingEnvFallback =
    (!dashscopeApiKeySaved && dashscopeApiKeyConfigured) ||
    (!storedOssComplete && effectiveOssComplete) ||
    (!ossAccessKeyIdSaved && ossAccessKeyIdConfigured) ||
    (!ossAccessKeySecretSaved && ossAccessKeySecretConfigured);

  return {
    dashscopeApiKeyConfigured,
    dashscopeApiKeySaved,
    dashscopeApiKeyMasked: maskSecret(storedConfig.dashscopeApiKey),
    ossEnabled: storedOssEnabled,
    ossRegion: storedConfig.ossRegion || defaultOssRegion,
    ossBucket: storedConfig.ossBucket || "",
    ossConfigured: effectiveOssComplete,
    ossAccessKeyIdConfigured,
    ossAccessKeyIdSaved,
    ossAccessKeyIdMasked: maskSecret(storedConfig.ossAccessKeyId),
    ossAccessKeySecretConfigured,
    ossAccessKeySecretSaved,
    ossAccessKeySecretMasked: maskSecret(storedConfig.ossAccessKeySecret),
    usingEnvFallback,
    setupComplete: true
  };
}

export function getDashScopeApiKey() {
  return readRuntimeConfig().dashscopeApiKey || "";
}

export function getQwenConfig() {
  return {
    apiKey: getDashScopeApiKey(),
    baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.QWEN_MODEL || "qwen-plus"
  };
}

export function getOssDirectUploadRuntimeConfig() {
  const config = readRuntimeConfig();

  if (!config.ossEnabled) {
    return null;
  }

  if (!config.ossBucket || !config.ossRegion || !config.ossAccessKeyId || !config.ossAccessKeySecret) {
    return null;
  }

  const endpointHost = createOssEndpointFromRegion(config.ossRegion);

  return {
    bucket: config.ossBucket,
    region: config.ossRegion,
    accessKeyId: config.ossAccessKeyId,
    accessKeySecret: config.ossAccessKeySecret,
    endpointHost,
    uploadHost: `https://${config.ossBucket}.${endpointHost}`,
    dir: trimSlashes(process.env.OSS_DIR || "meeting-audio"),
    expiresSeconds: Number(process.env.OSS_EXPIRES_SECONDS || 6 * 60 * 60)
  };
}

export function createOssEndpointFromRegion(region: string) {
  const normalizedRegion = region.replace(/^oss-/, "");
  return `oss-${normalizedRegion}.aliyuncs.com`;
}

export function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "") || "meeting-audio";
}

function maskSecret(value?: string) {
  if (!value) {
    return "";
  }

  return "已配置";
}
