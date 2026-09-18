"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface SchoolContextValue {
  schoolId: string | null;
  schoolName: string | null;
  schoolCode: string | null;
  setSchool: (school: { id: string; name: string; code: string }) => void;
  clearSchool: () => void;
}

const SchoolContext = createContext<SchoolContextValue | undefined>(undefined);

const STORAGE_KEY = "upmoo.school";

export function SchoolProvider({ children }: { children: React.ReactNode }) {
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [schoolCode, setSchoolCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSchoolId(parsed.id);
        setSchoolName(parsed.name);
        setSchoolCode(parsed.code);
      }
    } catch {
      // localStorage 접근 불가 시 무시
    }
  }, []);

  const setSchool = useCallback((school: { id: string; name: string; code: string }) => {
    setSchoolId(school.id);
    setSchoolName(school.name);
    setSchoolCode(school.code);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(school));
    } catch {
      // ignore
    }
  }, []);

  const clearSchool = useCallback(() => {
    setSchoolId(null);
    setSchoolName(null);
    setSchoolCode(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ schoolId, schoolName, schoolCode, setSchool, clearSchool }),
    [schoolId, schoolName, schoolCode, setSchool, clearSchool]
  );

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchool(): SchoolContextValue {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error("useSchool은 SchoolProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
