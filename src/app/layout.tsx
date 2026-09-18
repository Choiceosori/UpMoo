import type { Metadata } from "next";
import "./globals.css";
import { SchoolProvider } from "@/context/SchoolContext";

export const metadata: Metadata = {
  title: "UpMoo | 학교 업무 자료 수합 시스템",
  description: "학교 업무 담당자를 위한 자료 수합·병합·관리 웹 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SchoolProvider>{children}</SchoolProvider>
      </body>
    </html>
  );
}
