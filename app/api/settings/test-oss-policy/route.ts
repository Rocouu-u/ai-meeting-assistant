import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getOssDirectUploadRuntimeConfig } from "../../../../lib/runtime-config";

export const runtime = "nodejs";

export async function POST() {
  const config = getOssDirectUploadRuntimeConfig();

  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        message: "OSS 配置不完整，请先保存 OSS Bucket、Region 和 AccessKey。"
      },
      { status: 400 }
    );
  }

  const objectKey = `${config.dir}/config-test-${Date.now()}.txt`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const policy = Buffer.from(
    JSON.stringify({
      expiration: expiresAt,
      conditions: [
        ["starts-with", "$key", config.dir],
        ["content-length-range", 0, 1024 * 1024]
      ]
    })
  ).toString("base64");
  const signature = createHmac("sha1", config.accessKeySecret).update(policy).digest("base64");

  return NextResponse.json({
    ok: true,
    uploadUrl: config.uploadHost,
    fields: {
      OSSAccessKeyId: config.accessKeyId,
      Signature: signature,
      policy,
      key: objectKey,
      success_action_status: "200"
    }
  });
}
