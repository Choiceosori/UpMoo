"use client";

import { useEffect, useState } from "react";
import { SchoolGate } from "@/components/SchoolGate";
import { useSchool } from "@/context/SchoolContext";
import { ClassStructure } from "@/lib/types";

const GRADES = [1, 2, 3, 4, 5, 6];
const CURRENT_YEAR = new Date().getFullYear();

function ClassesInner() {
  const { schoolId } = useSchool();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [semester, setSemester] = useState(1);
  const [classCounts, setClassCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, year, semester]);

  const fetchClasses = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/classes?schoolId=${schoolId}&year=${year}&semester=${semester}`
      );
      const json = await res.json();
      const map: Record<number, number> = {};
      (json.classStructures ?? []).forEach((c: ClassStructure) => {
        map[c.grade] = c.class_count;
      });
      setClassCounts(map);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!schoolId) return;
    setSaving(true);
    setMessage(null);
    try {
      const grades = GRADES.map((grade) => ({
        grade,
        classCount: classCounts[grade] ?? 0,
      }));
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, year, semester, grades }),
      });
      if (!res.ok) throw new Error();
      setMessage("저장되었습니다.");
    } catch {
      setMessage("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">학년별 학급 수 등록</h1>
        <p className="mt-1 text-sm text-slate-500">
          연도/학기를 선택하고 학년별 학급 수를 입력하세요. (예: 1학년 5반, 2학년 6반)
        </p>
      </div>

      <div className="card space-y-6">
        <div className="flex gap-4">
          <div>
            <label className="label">연도</label>
            <input
              type="number"
              className="input w-28"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">학기</label>
            <select
              className="input w-28"
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
            >
              <option value={1}>1학기</option>
              <option value={2}>2학기</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중...</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {GRADES.map((grade) => (
              <div key={grade}>
                <label className="label">{grade}학년 학급 수</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={classCounts[grade] ?? 0}
                  onChange={(e) =>
                    setClassCounts((prev) => ({ ...prev, [grade]: Number(e.target.value) }))
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "저장 중..." : "저장"}
          </button>
          {message && <span className="text-sm text-slate-500">{message}</span>}
        </div>
      </div>
    </div>
  );
}

export default function ManagerClassesPage() {
  return (
    <SchoolGate>
      <ClassesInner />
    </SchoolGate>
  );
}
