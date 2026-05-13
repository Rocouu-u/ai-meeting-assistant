import { NextResponse } from "next/server";
import { readPublicRuntimeConfig, readStoredRuntimeConfig, saveRuntimeConfig } from "../../../lib/runtime-config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    config: readPublicRuntimeConfig()
  });
}

export async function POST(request: Request) {
  let body: {
    dashscopeApiKey?: string;
    ossEnabled?: boolean;
    ossRegion?: string;
    ossBucket?: string;
    ossAccessKeyId?: string;
    ossAccessKeySecret?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "配置内容格式不正确。"
      },
      { status: 400 }
    );
  }

  const storedConfig = readStoredRuntimeConfig();
  const nextConfig = {
    dashscopeApiKey: body.dashscopeApiKey?.trim() || storedConfig.dashscopeApiKey || "",
    ossEnabled: body.ossEnabled ?? true,
    ossRegion: body.ossRegion?.trim() || storedConfig.ossRegion || "",
    ossBucket: body.ossBucket?.trim() || storedConfig.ossBucket || "",
    ossAccessKeyId: body.ossAccessKeyId?.trim() || storedConfig.ossAccessKeyId || "",
    ossAccessKeySecret: body.ossAccessKeySecret?.trim() || storedConfig.ossAccessKeySecret || ""
  };
  const missingFields = getMissingRequiredFields(nextConfig);

  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        message: `缺少必填项：${missingFields.join("、")}`
      },
      { status: 400 }
    );
  }

  const publicConfig = saveRuntimeConfig(nextConfig);

  return NextResponse.json({
    ok: true,
    message: "配置已保存。",
    config: publicConfig
  });
}

function getMissingRequiredFields(config: {
  dashscopeApiKey?: string;
  ossEnabled?: boolean;
  ossRegion?: string;
  ossBucket?: string;
  ossAccessKeyId?: string;
  ossAccessKeySecret?: string;
}) {
  const missingFields: string[] = [];

  if (!config.dashscopeApiKey) {
    missingFields.push("DASHSCOPE_API_KEY");
  }

  if (config.ossEnabled !== false) {
    if (!config.ossRegion) {
      missingFields.push("OSS_REGION");
    }

    if (!config.ossBucket) {
      missingFields.push("OSS_BUCKET");
    }

    if (!config.ossAccessKeyId) {
      missingFields.push("OSS_ACCESS_KEY_ID");
    }

    if (!config.ossAccessKeySecret) {
      missingFields.push("OSS_ACCESS_KEY_SECRET");
    }
  }

  return missingFields;
}
