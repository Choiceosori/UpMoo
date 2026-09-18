"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SchoolGate } from "@/components/SchoolGate";
import { useSchool } from "@/context/SchoolContext";
import { CollectionTask, FILE_CATEGORY_LABELS, Submission } from "@/lib/types";

function TaskDetailInner() {
  const params = useParams<{ taskId: string }>();
  const { schoolId } = useSchool();
  const [task, setTask] = useState<CollectionTask | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId && params.taskId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, params.taskId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [taskRes, subRes] = await Promise.all([
        fetch(`/api/tasks/${params.taskId}`),
        fetch(`/api/submissions?schoolId=${schoolId}&taskId=${params.taskId}`),
      ]);
      const taskJson = await taskRes.json();
      const subJson = await subRes.json();
      setTask(taskJson.task ?? null);
      setSubmissions(subJson.submissions ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (category: "excel_general" | "excel_expense") => {
    setMerging(category);
    setMergeError(null);
    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: params.taskId, category }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "병합에 실패했습니다.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : `${task?.name}_통합.xlsx`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "병합 중 오류가 발생했습니다.");
    } finally {
      setMerging(null);
    }
  };

  if (loading || !task) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  const hasGeneral = task.allowed_file_types.includes("excel_general");
  const hasExpense = task.allowed_file_types.includes("excel_expense");
  const generalCount = submissions.filter((s) => s.file_category === "excel_general").length;
  const expenseCount = submissions.filter((s) => s.file_category === "excel_expense").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{task.name}</h1>
        {task.description && <p className="mt-1 text-sm text-slate-500">{task.description}</p>}
        <p className="mt-1 text-xs text-slate-400">
          {task.unit === "grade" ? "학년별 제출" : "학반별 제출"} ·{" "}
          {task.allowed_file_types.map((c) => FILE_CATEGORY_LABELS[c]).join(", ")}
          {task.deadline && ` · 마감 ${new Date(task.deadline).toLocaleString("ko-KR")}`}
        </p>
      </div>

      {(hasGeneral || hasExpense) && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-800">통합 파일 수합</h2>
          <p className="text-sm text-slate-500">
            클릭하면 제출된 파일을 하나로 병합한 엑셀 파일이 즉시 다운로드됩니다.
          </p>
          <div className="flex flex-wrap gap-3">
            {hasGeneral && (
              <button
                onClick={() => handleMerge("excel_general")}
                disabled={merging !== null || generalCount === 0}
                className="btn-primary"
              >
                {merging === "excel_general"
                  ? "병합 중..."
                  : `엑셀(일반) 통합 다운로드 (${generalCount}건)`}
              </button>
            )}
            {hasExpense && (
              <button
                onClick={() => handleMerge("excel_expense")}
                disabled={merging !== null || expenseCount === 0}
                className="btn-secondary"
              >
                {merging === "excel_expense"
                  ? "병합 중..."
                  : `엑셀(지출) 통합 다운로드 (${expenseCount}건)`}
              </button>
            )}
          </div>
          {mergeError && <p className="text-sm text-red-500">{mergeError}</p>}
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-800">제출 현황 ({submissions.length}건)</h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-slate-400">아직 제출된 자료가 없습니다.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">제출 단위</th>
                <th className="py-2">파일 종류</th>
                <th className="py-2">파일명</th>
                <th className="py-2">개인정보 확인</th>
                <th className="py-2">양식 확인</th>
                <th className="py-2">제출일</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-2">
                    {s.grade}학년{s.class_no ? ` ${s.class_no}반` : ""}
                  </td>
                  <td className="py-2">{FILE_CATEGORY_LABELS[s.file_category]}</td>
                  <td className="py-2 text-slate-700">{s.stored_filename}</td>
                  <td className="py-2">
                    {s.pii_flagged ? (
                      <span className="text-amber-600">⚠️ 확인 필요</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="py-2">
                    {s.expense_flagged ? (
                      <span className="text-amber-600">⚠️ 확인 필요</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="py-2 text-slate-400">
                    {new Date(s.created_at).toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function TaskDetailPage() {
  return (
    <SchoolGate>
      <TaskDetailInner />
    </SchoolGate>
  );
}
