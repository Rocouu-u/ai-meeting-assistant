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
    hfToken?: string;
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
    hfToken: body.hfToken?.trim() || storedConfig.hfToken || "",
    ossEnabled: body.ossEnabled ?? storedConfig.ossEnabled ?? false,
    ossRegion: body.ossRegion?.trim() || storedConfig.ossRegion || "",
    ossBucket: body.ossBucket?.trim() || storedConfig.ossBucket || "",
    ossAccessKeyId: body.ossAccessKeyId?.trim() || storedConfig.ossAccessKeyId || "",
    ossAccessKeySecret: body.ossAccessKeySecret?.trim() || storedConfig.ossAccessKeySecret || ""
  };

  const publicConfig = saveRuntimeConfig(nextConfig);

  return NextResponse.json({
    ok: true,
    message: "配置已保存。",
    config: publicConfig
  });
}
