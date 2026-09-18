"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { useSchool } from "@/context/SchoolContext";

type Role = "manager" | "submit";

export default function HomePage() {
  const router = useRouter();
  const { setSchool } = useSchool();
  const [role, setRole] = useState<Role>("manager");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError("학교 코드를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schools?code=${encodeURIComponent(code.trim())}`);
      const json = await res.json();
      const school = json.schools?.[0];
      if (!school) {
        setError("등록되지 않은 학교 코드입니다. 전체 관리자에게 문의하세요.");
        return;
      }
      setSchool({ id: school.id, name: school.name, code: school.code });
      router.push(role === "manager" ? "/manager" : "/submit");
    } catch {
      setError("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-12">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white shadow-card">
          U
        </div>
        <h1 className="text-3xl font-bold text-slate-900">UpMoo</h1>
        <p className="mt-2 text-slate-500">학교 업무 자료 수합 시스템</p>
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="card">
          <div className="mb-4 flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => setRole("manager")}
              className={clsx(
                "flex-1 rounded-md py-2 transition-colors",
                role === "manager" ? "bg-white text-brand-700 shadow" : "text-slate-500"
              )}
            >
              업무 담당자
            </button>
            <button
              type="button"
              onClick={() => setRole("submit")}
              className={clsx(
                "flex-1 rounded-md py-2 transition-colors",
                role === "submit" ? "bg-white text-brand-700 shadow" : "text-slate-500"
              )}
            >
              제출자
            </button>
          </div>

          <form onSubmit={handleEnter} className="space-y-3">
            <div>
              <label className="label">학교 코드</label>
              <input
                className="input"
                placeholder="예: AB12CD"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={12}
              />
              <p className="mt-1 text-xs text-slate-400">
                학교 코드는 전체 관리자가 학교 등록 시 발급합니다.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "확인 중..." : "입장하기"}
            </button>
          </form>
        </div>

        <div className="text-center text-sm text-slate-400">
          <Link href="/admin" className="font-medium text-slate-500 underline hover:text-brand-700">
            전체 관리자 페이지로 이동
          </Link>
        </div>
      </div>
    </div>
  );
}
