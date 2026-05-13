import { NextResponse } from "next/server";
import { renameMeetingRecord } from "../../../../../lib/history-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: { title?: string };

  try {
    body = (await request.json()) as { title?: string };
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "重命名内容格式不正确。"
      },
      { status: 400 }
    );
  }

  const title = body.title?.trim();

  if (!title) {
    return NextResponse.json(
      {
        ok: false,
        message: "记录名称不能为空。"
      },
      { status: 400 }
    );
  }

  const record = renameMeetingRecord(id, title);

  if (!record) {
    return NextResponse.json(
      {
        ok: false,
        message: "没有找到这条历史记录。"
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    record
  });
}
