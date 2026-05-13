import { NextResponse } from "next/server";
import { importMeetingRecords, listMeetingRecords, saveMeetingRecord } from "../../../lib/history-store";
import type { StoredMeetingRecord } from "../../../lib/history-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      records: listMeetingRecords()
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "读取本机历史记录失败。"
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: StoredMeetingRecord | { records?: StoredMeetingRecord[] };

  try {
    body = (await request.json()) as StoredMeetingRecord | { records?: StoredMeetingRecord[] };
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "保存内容格式不正确。"
      },
      { status: 400 }
    );
  }

  try {
    if ("records" in body && Array.isArray(body.records)) {
      const importedCount = importMeetingRecords(body.records);

      return NextResponse.json({
        ok: true,
        importedCount,
        records: listMeetingRecords()
      });
    }

    const record = body as StoredMeetingRecord;

    if (!record.id || !record.title) {
      return NextResponse.json(
        {
          ok: false,
          message: "缺少会议标题，无法保存历史记录。"
        },
        { status: 400 }
      );
    }

    const savedRecord = saveMeetingRecord(record);

    return NextResponse.json({
      ok: true,
      message: "已保存到 SQLite。",
      record: savedRecord
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "保存到 SQLite 失败，请稍后再试。"
      },
      { status: 500 }
    );
  }
}
