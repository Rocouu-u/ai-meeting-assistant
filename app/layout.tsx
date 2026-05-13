import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "会议录音转写与会议纪要生成工具",
  description: "会议录音转写与会议纪要生成工具的本地网页骨架"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
