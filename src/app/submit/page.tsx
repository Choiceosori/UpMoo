"use client";

import { useEffect, useMemo, useState } from "react";
import { SchoolGate } from "@/components/SchoolGate";
import { FileDropzone } from "@/components/FileDropzone";
import { WarningModal } from "@/components/WarningModal";
import { useSchool } from "@/context/SchoolContext";
import { scanExpenseExcel, scanFileForPii } from "@/lib/clientFileScan";
import { PII_WARNING_MESSAGE } from "@/lib/validators/pii";
import { EXPENSE_VALIDATION_WARNING_MESSAGE } from "@/lib/validators/expenseExcel";
import {
  ClassStructure,
  CollectionTask,
  FILE_CATEGORY_EXTENSIONS,
  FILE_CATEGORY_LABELS,
  FileCategory,
  Submission,
} from "@/lib/types";

function extAccept(categories: FileCategory[]): string {
  return categories.flatMap((c) => FILE_CATEGORY_EXTENSIONS[c]).join(",");
}

function SubmitInner() {
  const { schoolId } = useSchool();

  const [classStructures, setClassStructures] = useState<ClassStructure[]>([]);
  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);

  const [grade, setGrade] = useState<number | null>(null);
  const [classNo, setClassNo] = useState<number | null>(null);
  const [taskId, setTaskId] = useState<string>("");
  const [category, setCategory] = useState<FileCategory | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [piiFlagged, setPiiFlagged] = useState(false);
  const [expenseFlagged, setExpenseFlagged] = useState(false);

  const [warningQueue, setWarningQueue] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTask = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId]);

  const gradesAvailable = useMemo(() => {
    if (classStructures.length === 0) return [];
    const latestKey = classStructures.reduce((acc, c) => {
      const key = c.year * 10 + c.semester;
      return key > acc ? key : acc;
    }, 0);
    return classStructures
      .filter((c) => c.year * 10 + c.semester === latestKey)
      .sort((a, b) => a.grade - b.grade);
  }, [classStructures]);

  const classCountForGrade = gradesAvailable.find((g) => g.grade === grade)?.class_count ?? 0;

  useEffect(() => {
    if (!schoolId) return;
    fetch(`/api/classes?schoolId=${schoolId}`)
      .then((r) => r.json())
      .then((json) => setClassStructures(json.classStructures ?? []));
    fetch(`/api/tasks?schoolId=${schoolId}`)
      .then((r) => r.json())
      .then((json) => setTasks(json.tasks ?? []));
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || grade === null) {
      setMySubmissions([]);
      return;
    }
    const params = new URLSearchParams({ schoolId, grade: String(grade) });
    if (classNo !== null) params.set("classNo", String(classNo));
    fetch(`/api/submissions?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => setMySubmissions(json.submissions ?? []));
  }, [schoolId, grade, classNo, message]);

  const resetFileState = () => {
    setFile(null);
    setPiiFlagged(false);
    setExpenseFlagged(false);
  };

  const handleTaskChange = (id: string) => {
    setTaskId(id);
    setCategory("");
    resetFileState();
    const task = tasks.find((t) => t.id === id);
    if (task?.unit === "grade") setClassNo(null);
  };

  const handleFileSelected = async (selected: File) => {
    setError(null);
    setFile(selected);
    setScanning(true);
    const queue: string[] = [];
    try {
      const flaggedPii = await scanFileForPii(selected);
      setPiiFlagged(flaggedPii);
      if (flaggedPii) queue.push(PII_WARNING_MESSAGE);

      if (category === "excel_expense") {
        const flaggedExpense = await scanExpenseExcel(selected);
        setExpenseFlagged(flaggedExpense);
        if (flaggedExpense) queue.push(EXPENSE_VALIDATION_WARNING_MESSAGE);
      } else {
        setExpenseFlagged(false);
      }
    } catch {
      // 파싱 실패 시(형식 미지원 등) 경고 없이 진행하되, 담당자 확인을 권장
    } finally {
      setScanning(false);
      setWarningQueue(queue);
    }
  };

  const dismissWarning = () => {
    setWarningQueue((prev) => prev.slice(1));
  };

  const canSubmit =
    grade !== null &&
    (selectedTask?.unit !== "class" || classNo !== null) &&
    taskId &&
    category &&
    file &&
    !scanning &&
    warningQueue.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit || !schoolId || !file || grade === null) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set("schoolId", schoolId);
      formData.set("taskId", taskId);
      formData.set("grade", String(grade));
      if (classNo !== null) formData.set("classNo", String(classNo));
      formData.set("fileCategory", category);
      formData.set("piiFlagged", String(piiFlagged));
      formData.set("expenseFlagged", String(expenseFlagged));
      formData.set("file", file);

      const res = await fetch("/api/submissions", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "제출에 실패했습니다.");

      setMessage("제출이 완료되었습니다.");
      resetFileState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "제출 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSubmission = async (id: string) => {
    if (!confirm("제출한 자료를 삭제할까요?")) return;
    await fetch(`/api/submissions/${id}`, { method: "DELETE" });
    setMessage(`삭제됨_${Date.now()}`);
  };

  const handleReupload = async (submissionId: string, newFile: File) => {
    const formData = new FormData();
    formData.set("file", newFile);
    const flaggedPii = await scanFileForPii(newFile);
    formData.set("piiFlagged", String(flaggedPii));
    if (flaggedPii) alert(PII_WARNING_MESSAGE);

    await fetch(`/api/submissions/${submissionId}`, { method: "PATCH", body: formData });
    setMessage(`재업로드됨_${Date.now()}`);
  };

  const taskOfSubmission = (sub: Submission) => tasks.find((t) => t.id === sub.task_id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">자료 제출</h1>
        <p className="mt-1 text-sm text-slate-500">
          학년/반과 업무를 선택한 뒤 파일을 업로드하세요. 제출 시 자동으로 규칙에 맞게 파일명이
          변경됩니다.
        </p>
      </div>

      <div className="card space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">학년</label>
            <select
              className="input"
              value={grade ?? ""}
              onChange={(e) => {
                setGrade(e.target.value ? Number(e.target.value) : null);
                setClassNo(null);
              }}
            >
              <option value="">선택하세요</option>
              {gradesAvailable.map((g) => (
                <option key={g.grade} value={g.grade}>
                  {g.grade}학년
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">반</label>
            <select
              className="input"
              value={classNo ?? ""}
              disabled={grade === null || selectedTask?.unit === "grade"}
              onChange={(e) => setClassNo(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">
                {selectedTask?.unit === "grade" ? "학년 단위 제출 (반 선택 불필요)" : "선택하세요"}
              </option>
              {Array.from({ length: classCountForGrade }, (_, i) => i + 1).map((c) => (
                <option key={c} value={c}>
                  {c}반
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">업무명</label>
          <select className="input" value={taskId} onChange={(e) => handleTaskChange(e.target.value)}>
            <option value="">수합 중인 업무를 선택하세요</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.deadline ? ` (마감 ${new Date(t.deadline).toLocaleDateString("ko-KR")})` : ""}
              </option>
            ))}
          </select>
          {selectedTask?.description && (
            <p className="mt-1 text-xs text-slate-400">{selectedTask.description}</p>
          )}
        </div>

        {selectedTask && (
          <div>
            <label className="label">제출 파일 종류</label>
            <div className="flex flex-wrap gap-3 text-sm">
              {selectedTask.allowed_file_types.map((cat) => (
                <label
                  key={cat}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <input
                    type="radio"
                    name="category"
                    checked={category === cat}
                    onChange={() => {
                      setCategory(cat);
                      resetFileState();
                    }}
                  />
                  {FILE_CATEGORY_LABELS[cat]}
                </label>
              ))}
            </div>
          </div>
        )}

        {category && (
          <div>
            <label className="label">파일 업로드</label>
            <FileDropzone
              accept={extAccept([category])}
              file={file}
              onFileSelected={handleFileSelected}
              disabled={scanning}
              helperText={`허용 형식: ${FILE_CATEGORY_EXTENSIONS[category].join(", ")}`}
            />
            {scanning && <p className="mt-2 text-xs text-slate-400">파일 내용을 확인하는 중...</p>}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        {message && <p className="text-sm text-emerald-600">{message}</p>}

        <button onClick={handleSubmit} disabled={!canSubmit || submitting} className="btn-primary">
          {submitting ? "제출 중..." : "제출하기"}
        </button>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-800">내 제출 자료</h2>
        {grade === null ? (
          <p className="text-sm text-slate-400">학년을 선택하면 제출 내역이 표시됩니다.</p>
        ) : mySubmissions.length === 0 ? (
          <p className="text-sm text-slate-400">제출한 자료가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mySubmissions.map((sub) => (
              <li key={sub.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-slate-800">{sub.stored_filename}</p>
                  <p className="text-xs text-slate-400">
                    {taskOfSubmission(sub)?.name ?? "알 수 없는 업무"} ·{" "}
                    {FILE_CATEGORY_LABELS[sub.file_category]} ·{" "}
                    {new Date(sub.created_at).toLocaleString("ko-KR")}
                    {sub.pii_flagged && " · ⚠️ 개인정보 확인 필요"}
                    {sub.expense_flagged && " · ⚠️ 양식 확인 필요"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="btn-secondary cursor-pointer text-xs">
                    재업로드
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleReupload(sub.id, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={() => handleDeleteSubmission(sub.id)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WarningModal
        open={warningQueue.length > 0}
        title="확인이 필요합니다"
        message={warningQueue[0] ?? ""}
        onConfirm={dismissWarning}
      />
    </div>
  );
}

export default function SubmitPage() {
  return (
    <SchoolGate requiredRole="submit">
      <SubmitInner />
    </SchoolGate>
  );
}
