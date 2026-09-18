"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSchool } from "@/context/SchoolContext";
import { Navbar } from "./Navbar";

export function SchoolGate({ children }: { children: React.ReactNode }) {
  const { schoolId } = useSchool();
  const router = useRouter();

  useEffect(() => {
    if (schoolId === null) {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("upmoo.school") : null;
      if (!raw) {
        router.replace("/");
      }
    }
  }, [schoolId, router]);

  if (!schoolId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        학교 정보를 불러오는 중...
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
