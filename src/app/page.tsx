"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import {
  LayoutDashboard,
  GraduationCap,
  KeyRound,
  ArrowRight,
  Settings2,
  FileStack,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { useSchool, UserRole } from "@/context/SchoolContext";

type Role = UserRole;

const ROLE_OPTIONS: {
  role: Role;
  icon: typeof LayoutDashboard;
  title: string;
  desc: string;
}[] = [
  {
    role: "manager",
    icon: LayoutDashboard,
    title: "업무 담당자",
    desc: "업무 등록 · 학급 편성 · 통합 수합",
  },
  {
    role: "submit",
    icon: GraduationCap,
    title: "학급 담임",
    desc: "자료 제출 · 조회 · 수정",
  },
];

const FEATURES = [
  { icon: FileStack, label: "엑셀·PDF·HWP 자동 통합" },
  { icon: ShieldCheck, label: "개인정보 자동 검출" },
  { icon: Activity, label: "실시간 제출 현황" },
];

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
      setSchool({ id: school.id, name: school.name, code: school.code, role });
      router.push(role === "manager" ? "/manager" : "/submit");
    } catch {
      setError("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      {/* 배경 메시 그라데이션 — 단조로운 흰 배경 대신 은은한 색 덩어리 두 개로 입체감을 줍니다 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-32 h-[28rem] w-[28rem] rounded-full bg-gradient-to-br from-brand-400/30 to-violet-400/20 blur-3xl" />
        <div className="absolute -right-24 top-0 h-[24rem] w-[24rem] rounded-full bg-gradient-to-bl from-sky-300/25 to-brand-300/15 blur-3xl" />
      </div>

      <div className="mb-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-2xl font-bold text-white shadow-glow">
          U
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">UpMoo</h1>
        <p className="mt-2.5 text-slate-500">학교 업무 자료, 흩어지지 않게 한 곳에서 수합하세요</p>
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="card !p-7">
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            {ROLE_OPTIONS.map(({ role: r, icon: Icon, title, desc }) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={clsx(
                  "group relative overflow-hidden rounded-xl border p-3.5 text-left transition-all duration-150",
                  role === r
                    ? "border-brand-300 bg-brand-50/70 ring-2 ring-brand-500/20"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                )}
              >
                <Icon
                  className={clsx(
                    "mb-2 h-5 w-5 transition-colors",
                    role === r ? "text-brand-600" : "text-slate-400 group-hover:text-slate-500"
                  )}
                />
                <p
                  className={clsx(
                    "text-sm font-semibold",
                    role === r ? "text-brand-800" : "text-slate-700"
                  )}
                >
                  {title}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-slate-500">{desc}</p>
              </button>
            ))}
          </div>

          <form onSubmit={handleEnter} className="space-y-3">
            <div>
              <label className="label">학교 코드</label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-9 tracking-widest"
                  placeholder="예: AB12CD"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={12}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                학교 코드는 전체 관리자가 학교 등록 시 발급합니다.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex w-full items-center justify-center gap-1.5"
            >
              {loading ? "확인 중..." : "입장하기"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-x-5 gap-y-1.5 flex-wrap px-2 text-xs text-slate-500">
          {FEATURES.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-brand-500" />
              {label}
            </span>
          ))}
        </div>

        <div className="text-center text-sm text-slate-400">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:decoration-brand-400"
          >
            <Settings2 className="h-3.5 w-3.5" />
            전체 관리자 페이지로 이동
          </Link>
        </div>
      </div>
    </div>
  );
}
