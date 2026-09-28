"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSchool, UserRole } from "@/context/SchoolContext";
import { Navbar } from "./Navbar";

interface SchoolGateProps {
  children: React.ReactNode;
  /** 지정하면 해당 역할이 아닌 사용자는 자신의 역할 홈으로 리다이렉트됩니다. */
  requiredRole?: UserRole;
}

export function SchoolGate({ children, requiredRole }: SchoolGateProps) {
  const { schoolId, role } = useSchool();
  const router = useRouter();

  useEffect(() => {
    if (schoolId === null) {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("upmoo.school") : null;
      if (!raw) {
        router.replace("/");
      }
      return;
    }

    if (requiredRole && role !== requiredRole) {
      // role이 null인 과거 세션(역할 구분 도입 이전)은 안전하게 역할을 다시 선택하도록 안내합니다.
      router.replace(role ? (role === "manager" ? "/manager" : "/submit") : "/");
    }
  }, [schoolId, role, requiredRole, router]);

  if (!schoolId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        학교 정보를 불러오는 중...
      </div>
    );
  }

  if (requiredRole && role !== requiredRole) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        이동하는 중...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
