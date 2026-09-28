"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { useSchool } from "@/context/SchoolContext";

const MANAGER_NAV_ITEMS = [
  { href: "/manager", label: "담당자 홈" },
  { href: "/manager/classes", label: "학급 편성" },
  { href: "/manager/tasks", label: "수합 업무" },
];

const SUBMIT_NAV_ITEMS = [{ href: "/submit", label: "자료 제출" }];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { schoolName, schoolCode, role, clearSchool } = useSchool();
  const navItems = role === "submit" ? SUBMIT_NAV_ITEMS : MANAGER_NAV_ITEMS;

  const handleChangeSchool = () => {
    clearSchool();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-brand-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            U
          </span>
          <span>UpMoo</span>
          <span className="text-sm font-normal text-slate-400">학교 업무 수합</span>
        </Link>

        <nav className="hidden gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {schoolName && (
            <div className="hidden text-right sm:block">
              <p className="font-semibold text-slate-700">
                {schoolName}
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
                  {role === "manager" ? "업무 담당자" : "학급 담임"}
                </span>
              </p>
              <p className="text-xs text-slate-400">코드 {schoolCode}</p>
            </div>
          )}
          <button
            onClick={handleChangeSchool}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-500 hover:bg-slate-50"
          >
            학교/역할 변경
          </button>
        </div>
      </div>
    </header>
  );
}
