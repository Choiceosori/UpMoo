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
  Users,
  ClipboardList,
  UploadCloud,
  FileCheck2,
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
  {
    icon: FileStack,
    title: "자료 수합을 한 곳에서",
    desc: "엑셀, PDF, HWP(한글) 파일을 업무별로 모으고 하나의 파일로 자동 병합합니다.",
  },
  {
    icon: ShieldCheck,
    title: "개인정보 자동 검출",
    desc: "주민등록번호, 이름 등 민감 정보가 담긴 파일을 업로드 전에 자동으로 잡아냅니다.",
  },
  {
    icon: Activity,
    title: "실시간 제출 현황",
    desc: "학급별 제출 여부를 한눈에 보고, 미흡한 자료엔 수정 요청을 바로 보낼 수 있습니다.",
  },
  {
    icon: Users,
    title: "학교별 독립 운영",
    desc: "학교 코드로 구분되어, 여러 학교가 동시에 서로 간섭 없이 사용할 수 있습니다.",
  },
];

const MANAGER_STEPS = [
  { icon: KeyRound, title: "학교 코드로 입장", desc: "전체 관리자에게 받은 코드로 '업무 담당자'로 들어갑니다." },
  { icon: Users, title: "학급 편성 등록", desc: "학년별 학급 수를 등록해 제출자가 선택할 수 있게 합니다." },
  { icon: ClipboardList, title: "수합 업무 등록", desc: "파일 종류(엑셀·PDF·HWP)와 마감일을 정해 업무를 만듭니다." },
  { icon: FileCheck2, title: "현황 확인·통합 다운로드", desc: "제출 현황을 확인하고 하나의 파일로 통합 다운로드합니다." },
];

const SUBMIT_STEPS = [
  { icon: KeyRound, title: "학교 코드로 입장", desc: "같은 학교 코드로 '학급 담임'으로 들어갑니다." },
  { icon: GraduationCap, title: "학년·반 선택", desc: "담당 학급을 선택하면 제출할 업무 목록이 보입니다." },
  { icon: UploadCloud, title: "자료 업로드", desc: "업로드 전 개인정보·양식을 자동으로 검증해 알려줍니다." },
  { icon: FileCheck2, title: "제출 완료", desc: "제출 내역을 언제든 확인하고, 필요하면 재업로드합니다." },
];

function StepList({ steps }: { steps: typeof MANAGER_STEPS }) {
  return (
    <ol className="space-y-5">
      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-4">
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute left-[19px] top-10 h-[calc(100%+0.25rem)] w-px bg-slate-200"
            />
          )}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 ring-4 ring-white">
            {i + 1}
          </span>
          <div className="pt-1.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <step.icon className="h-4 w-4 text-brand-500" />
              {step.title}
            </p>
            <p className="mt-0.5 text-sm leading-snug text-slate-500">{step.desc}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

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
    <div className="bg-slate-50">
      {/* ── 히어로 + 로그인 ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:pt-20">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -left-24 -top-32 h-[28rem] w-[28rem] rounded-full bg-gradient-to-br from-brand-400/30 to-violet-400/20 blur-3xl" />
          <div className="absolute -right-24 top-0 h-[24rem] w-[24rem] rounded-full bg-gradient-to-bl from-sky-300/25 to-brand-300/15 blur-3xl" />
        </div>

        <div className="mx-auto mb-10 max-w-md text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-2xl font-bold text-white shadow-glow">
            U
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">UpMoo</h1>
          <p className="mt-2.5 text-slate-500">학교 업무 자료, 흩어지지 않게 한 곳에서 수합하세요</p>
        </div>

        <div className="mx-auto w-full max-w-md space-y-6">
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
      </section>

      {/* ── 개요: 무엇을 할 수 있나요 ──────────────────────────────────── */}
      <section className="border-t border-slate-200/70 bg-white px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <p className="text-sm font-semibold text-brand-600">개요</p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
              무엇을 할 수 있나요?
            </h2>
            <p className="mt-2.5 text-sm text-slate-500">
              여러 학급에서 올라오는 엑셀·PDF·HWP 자료를, 수합부터 검증·병합까지 한 서비스에서
              처리합니다.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="card !p-5">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-slate-800">{title}</p>
                <p className="mt-1 text-sm leading-snug text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 사용 방법 ──────────────────────────────────────────────── */}
      <section className="border-t border-slate-200/70 px-4 py-16">
        <div className="mx-auto max-w-4xl">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <p className="text-sm font-semibold text-brand-600">사용 방법</p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
              역할에 맞춰 바로 시작하세요
            </h2>
            <p className="mt-2.5 text-sm text-slate-500">
              업무 담당자와 학급 담임은 같은 학교 코드로 입장하지만, 이후 화면과 흐름이 다릅니다.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="card !p-6">
              <p className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                <LayoutDashboard className="h-4 w-4 text-brand-600" />
                업무 담당자
              </p>
              <StepList steps={MANAGER_STEPS} />
            </div>
            <div className="card !p-6">
              <p className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                <GraduationCap className="h-4 w-4 text-brand-600" />
                학급 담임(제출자)
              </p>
              <StepList steps={SUBMIT_STEPS} />
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/70 bg-white px-4 py-8 text-center text-xs text-slate-400">
        UpMoo · 학교 업무 자료 수합 시스템
      </footer>
    </div>
  );
}
