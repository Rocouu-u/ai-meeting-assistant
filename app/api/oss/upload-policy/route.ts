import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getOssDirectUploadRuntimeConfig, readRuntimeConfig } from "../../../../lib/runtime-config";

type UploadPolicyRequest = {
  fileName?: string;
  fileType?: string;
  fileSize?: number;
};

export async function POST(request: Request) {
  let body: UploadPolicyRequest;

  try {
    body = (await request.json()) as UploadPolicyRequest;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        enabled: false,
        message: "请求格式不正确。"
      },
      { status: 400 }
    );
  }

  if (!isOssDirectUploadEnabled()) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      message: "OSS 直传未开启，继续使用阿里云百炼临时上传。"
    });
  }

  const config = getOssDirectUploadConfig();

  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        message: "OSS 直传配置不完整，请检查 .env.local。"
      },
      { status: 400 }
    );
  }

  const fileName = sanitizeFileName(body.fileName || "meeting-audio");
  const objectKey = `${config.dir}/${Date.now()}-${fileName}`;
  const expiresAt = new Date(Date.now() + config.expiresSeconds * 1000).toISOString();
  const maxFileSize = Math.max(body.fileSize || 0, 1024 * 1024 * 1024);
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
  const fileUrl = createSignedOssUrl(config, objectKey);

  console.info(
    "OSS direct upload info",
    JSON.stringify({
      stage: "oss_file_url_ready",
      bucket: config.bucket,
      endpointHost: config.endpointHost,
      fileType: body.fileType || "unknown",
      fileSize: body.fileSize || 0
    })
  );

  return NextResponse.json({
    ok: true,
    enabled: true,
    uploadUrl: config.uploadHost,
    objectKey,
    fileUrl,
    fields: {
      OSSAccessKeyId: config.accessKeyId,
      Signature: signature,
      policy,
      key: objectKey,
      success_action_status: "200"
    }
  });
}

function isOssDirectUploadEnabled() {
  return readRuntimeConfig().ossEnabled === true;
}

function getOssDirectUploadConfig() {
  return getOssDirectUploadRuntimeConfig();
}

function createSignedOssUrl(
  config: {
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    uploadHost: string;
    expiresSeconds: number;
  },
  objectKey: string
) {
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

function sanitizeFileName(fileName: string) {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "meeting-audio";
}

function encodeOssObjectKey(objectKey: string) {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}
