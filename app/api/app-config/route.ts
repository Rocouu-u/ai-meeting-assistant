import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    recordRetentionDays: readPositiveInteger(process.env.RECORD_RETENTION_DAYS, 30),
    ossAudioRetentionDays: readPositiveInteger(process.env.OSS_AUDIO_RETENTION_DAYS, 7)
  });
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}
