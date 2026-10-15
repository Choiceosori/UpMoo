"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SchoolGate } from "@/components/SchoolGate";
import { CorrectionRequestModal } from "@/components/CorrectionRequestModal";
import { useSchool } from "@/context/SchoolContext";
import { CollectionTask, FILE_CATEGORY_LABELS, Submission } from "@/lib/types";

function downloadBlobResponse(blob: Blob, disposition: string | null, fallbackName: string) {
  const url = URL.createObjectURL(blob);
  const match = disposition ? /filename\*=UTF-8''([^;]+)/.exec(disposition) : null;
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function TaskDetailInner() {
  const params = useParams<{ taskId: string }>();
  const { schoolId } = useSchool();
  const [task, setTask] = useState<CollectionTask | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const [exampleUploading, setExampleUploading] = useState(false);
  const [exampleError, setExampleError] = useState<string | null>(null);

  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const [correctionTarget, setCorrectionTarget] = useState<string | null>(null);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);

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

  const handleMerge = async (category: "excel_general" | "excel_expense" | "pdf" | "hwp") => {
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
      const fallbackExt = category === "pdf" ? "pdf" : category === "hwp" ? "hwp" : "xlsx";
      downloadBlobResponse(
        blob,
        res.headers.get("Content-Disposition"),
        `${task?.name}_통합.${fallbackExt}`
      );
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "병합 중 오류가 발생했습니다.");
    } finally {
      setMerging(null);
    }
  };

  const handleDownloadZip = async () => {
    setZipping(true);
    setZipError(null);
    try {
      const res = await fetch("/api/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: params.taskId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "ZIP 생성에 실패했습니다.");
      }
      const blob = await res.blob();
      downloadBlobResponse(blob, res.headers.get("Content-Disposition"), `${task?.name}_전체파일.zip`);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : "ZIP 생성 중 오류가 발생했습니다.");
    } finally {
      setZipping(false);
    }
  };

  const handleUploadExample = async (file: File) => {
    setExampleUploading(true);
    setExampleError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const res = await fetch(`/api/tasks/${params.taskId}/example`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "예시 양식 업로드에 실패했습니다.");
      setTask(json.task);
    } catch (err) {
      setExampleError(err instanceof Error ? err.message : "예시 양식 업로드 중 오류가 발생했습니다.");
    } finally {
      setExampleUploading(false);
    }
  };

  const handleRemoveExample = async () => {
    if (!confirm("예시 양식 파일을 삭제할까요?")) return;
    await fetch(`/api/tasks/${params.taskId}/example`, { method: "DELETE" });
    setTask((prev) => (prev ? { ...prev, example_storage_path: null, example_filename: null } : prev));
  };

  const handleDownloadExample = async () => {
    const res = await fetch(`/api/tasks/${params.taskId}/example`);
    const json = await res.json();
    if (json.downloadUrl) window.open(json.downloadUrl, "_blank");
  };

  const handleSubmitCorrection = async (category: string, detail: string) => {
    if (!correctionTarget) return;
    setCorrectionSubmitting(true);
    try {
      const message = detail ? `[${category}] ${detail}` : `[${category}]`;
      const res = await fetch(`/api/submissions/${correctionTarget}/correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        setCorrectionTarget(null);
        fetchData();
      }
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const handleCancelCorrection = async (submissionId: string) => {
    const res = await fetch(`/api/submissions/${submissionId}/correction`, { method: "DELETE" });
    if (res.ok) fetchData();
  };

  if (loading || !task) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  const hasGeneral = task.allowed_file_types.includes("excel_general");
  const hasExpense = task.allowed_file_types.includes("excel_expense");
  const hasPdf = task.allowed_file_types.includes("pdf");
  const hasHwp = task.allowed_file_types.includes("hwp");
  const generalCount = submissions.filter((s) => s.file_category === "excel_general").length;
  const expenseCount = submissions.filter((s) => s.file_category === "excel_expense").length;
  const pdfCount = submissions.filter((s) => s.file_category === "pdf").length;
  const hwpCount = submissions.filter((s) => s.file_category === "hwp").length;

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

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800">예시 양식</h2>
        <p className="text-sm text-slate-500">
          제출자가 참고할 예시 양식 파일을 올려두면, 자료 제출 화면에 다운로드 링크로 표시됩니다.
        </p>
        {task.example_filename ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-700">📎 {task.example_filename}</span>
            <button onClick={handleDownloadExample} className="text-brand-600 hover:underline">
              다운로드
            </button>
            <label className="btn-secondary cursor-pointer text-xs">
              {exampleUploading ? "업로드 중..." : "교체"}
              <input
                type="file"
                className="hidden"
                disabled={exampleUploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadExample(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button onClick={handleRemoveExample} className="text-xs text-red-500 hover:underline">
              삭제
            </button>
          </div>
        ) : (
          <label className="btn-primary inline-block cursor-pointer">
            {exampleUploading ? "업로드 중..." : "예시 양식 업로드"}
            <input
              type="file"
              className="hidden"
              disabled={exampleUploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadExample(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {exampleError && <p className="text-sm text-red-500">{exampleError}</p>}
      </div>

      {(hasGeneral || hasExpense || hasPdf || hasHwp || submissions.length > 0) && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-800">제출 파일 모아받기</h2>
          <p className="text-sm text-slate-500">
            엑셀/PDF/HWP는 각각 하나의 파일로 병합하고, 파일 종류 상관없이 전체를 ZIP으로도 받을
            수 있습니다. HWP 통합은 실험적 기능이니 결과물을 실제 한글 프로그램에서 열어 꼭
            확인해주세요 — 문제가 있으면 ZIP으로 받아 개별 확인하세요.
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
            {hasPdf && (
              <button
                onClick={() => handleMerge("pdf")}
                disabled={merging !== null || pdfCount === 0}
                className="btn-secondary"
              >
                {merging === "pdf" ? "병합 중..." : `PDF 통합 다운로드 (${pdfCount}건)`}
              </button>
            )}
            {hasHwp && (
              <button
                onClick={() => handleMerge("hwp")}
                disabled={merging !== null || hwpCount === 0}
                className="btn-secondary"
                title="실험적 기능: 결과물을 반드시 한글 프로그램에서 열어 확인하세요."
              >
                {merging === "hwp" ? "병합 중..." : `HWP 통합 다운로드 (${hwpCount}건, 실험적)`}
              </button>
            )}
            {submissions.length > 0 && (
              <button onClick={handleDownloadZip} disabled={zipping} className="btn-secondary">
                {zipping ? "압축 중..." : `전체 파일 ZIP 다운로드 (${submissions.length}건)`}
              </button>
            )}
          </div>
          {mergeError && <p className="text-sm text-red-500">{mergeError}</p>}
          {zipError && <p className="text-sm text-red-500">{zipError}</p>}
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
                <th className="py-2">수정 요청</th>
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
                  <td className="py-2">
                    {s.correction_requested ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="text-red-500"
                          title={s.correction_message ?? undefined}
                        >
                          🔴 요청됨
                        </span>
                        <button
                          onClick={() => handleCancelCorrection(s.id)}
                          className="text-xs text-slate-400 hover:underline"
                        >
                          해제
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setCorrectionTarget(s.id)}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        수정 요청
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CorrectionRequestModal
        open={correctionTarget !== null}
        submitting={correctionSubmitting}
        onCancel={() => setCorrectionTarget(null)}
        onSubmit={handleSubmitCorrection}
      />
    </div>
  );
}

export default function TaskDetailPage() {
  return (
    <SchoolGate requiredRole="manager">
      <TaskDetailInner />
    </SchoolGate>
  );
}
