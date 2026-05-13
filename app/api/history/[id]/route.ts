import { NextResponse } from "next/server";
import { deleteMeetingRecord, getMeetingRecord, updateMeetingRecord } from "../../../../lib/history-store";
import type { StoredMeetingRecord } from "../../../../lib/history-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const record = getMeetingRecord(id);

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

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let patch: Partial<StoredMeetingRecord>;

  try {
    patch = (await request.json()) as Partial<StoredMeetingRecord>;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "更新内容格式不正确。"
      },
      { status: 400 }
    );
  }

  const record = updateMeetingRecord(id, patch);

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

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  deleteMeetingRecord(id);

  return NextResponse.json({
    ok: true
  });
}
