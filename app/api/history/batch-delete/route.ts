import { NextResponse } from "next/server";
import { batchDeleteMeetingRecords } from "../../../../lib/history-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { ids?: string[] };

  try {
    body = (await request.json()) as { ids?: string[] };
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "删除内容格式不正确。"
      },
      { status: 400 }
    );
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];

  if (ids.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "请选择要删除的记录。"
      },
      { status: 400 }
    );
  }

  const deletedCount = batchDeleteMeetingRecords(ids);

  return NextResponse.json({
    ok: true,
    deletedCount
  });
}
