"use client";

import Link from "next/link";
import { SchoolGate } from "@/components/SchoolGate";

export default function ManagerHomePage() {
  return (
    <SchoolGate requiredRole="manager">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">업무 담당자 홈</h1>
          <p className="mt-1 text-sm text-slate-500">
            학급 편성을 먼저 등록한 뒤, 수합 업무를 만들어 학급 담임에게 안내하세요.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/manager/classes" className="card transition hover:shadow-lg">
            <div className="text-3xl">🏫</div>
            <h2 className="mt-2 font-semibold text-slate-800">학년별 학급 수 등록</h2>
            <p className="mt-1 text-sm text-slate-500">
              연도/학기별로 학년과 학급 수를 설정합니다.
            </p>
          </Link>

          <Link href="/manager/tasks" className="card transition hover:shadow-lg">
            <div className="text-3xl">🗂️</div>
            <h2 className="mt-2 font-semibold text-slate-800">수합 업무 관리</h2>
            <p className="mt-1 text-sm text-slate-500">
              업무 등록, 제출 파일 종류 설정, 순서 변경, 통합 파일 수합을 진행합니다.
            </p>
          </Link>
        </div>
      </div>
    </SchoolGate>
  );
}
