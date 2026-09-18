"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import { SchoolGate } from "@/components/SchoolGate";
import { useSchool } from "@/context/SchoolContext";
import {
  CollectionTask,
  FILE_CATEGORY_LABELS,
  FileCategory,
  SubmissionUnit,
} from "@/lib/types";

const ALL_CATEGORIES: FileCategory[] = ["hwp", "pdf", "excel_general", "excel_expense"];

function TasksInner() {
  const { schoolId } = useSchool();
  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [unit, setUnit] = useState<SubmissionUnit>("class");
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId) fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?schoolId=${schoolId}`);
      const json = await res.json();
      setTasks(json.tasks ?? []);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (cat: FileCategory) => {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("업무명을 입력해주세요.");
      return;
    }
    if (categories.length === 0) {
      setError("허용할 파일 종류를 하나 이상 선택해주세요.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          name,
          description,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          unit,
          allowedFileTypes: categories,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setName("");
      setDescription("");
      setDeadline("");
      setUnit("class");
      setCategories([]);
      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "업무 등록에 실패했습니다.");
    } finally {
      setCreating(false);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const reordered = Array.from(tasks);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setTasks(reordered);

    await fetch("/api/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedTaskIds: reordered.map((t) => t.id) }),
    });
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("이 수합 업무와 제출된 모든 자료가 삭제됩니다. 계속할까요?")) return;
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    fetchTasks();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">수합 업무 관리</h1>
        <p className="mt-1 text-sm text-slate-500">
          업무를 등록하고, 드래그하여 수합 순서를 조정하세요.
        </p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="font-semibold text-slate-800">신규 수합 업무 등록</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">업무명</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">마감일</label>
            <input
              type="datetime-local"
              className="input"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">설명</label>
          <textarea
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="label">수합 단위</label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={unit === "grade"}
                onChange={() => setUnit("grade")}
              />
              학년별 제출
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={unit === "class"}
                onChange={() => setUnit("class")}
              />
              학반별 제출
            </label>
          </div>
        </div>

        <div>
          <label className="label">제출 허용 파일 종류 (복수 선택)</label>
          <div className="flex flex-wrap gap-3 text-sm">
            {ALL_CATEGORIES.map((cat) => (
              <label
                key={cat}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={categories.includes(cat)}
                  onChange={() => toggleCategory(cat)}
                />
                {FILE_CATEGORY_LABELS[cat]}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={creating} className="btn-primary">
          {creating ? "등록 중..." : "업무 등록"}
        </button>
      </form>

      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-800">수합 업무 목록 (드래그하여 순서 변경)</h2>
        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중...</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-slate-400">등록된 업무가 없습니다.</p>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="tasks">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                  {tasks.map((task, index) => (
                    <Draggable key={task.id} draggableId={task.id} index={index}>
                      {(dragProvided, snapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={`flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 ${
                            snapshot.isDragging ? "shadow-lg" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              {...dragProvided.dragHandleProps}
                              className="cursor-grab text-slate-300"
                              title="드래그하여 순서 변경"
                            >
                              ⠿
                            </span>
                            <div>
                              <Link
                                href={`/manager/tasks/${task.id}`}
                                className="font-medium text-slate-800 hover:text-brand-700"
                              >
                                {task.name}
                              </Link>
                              <p className="text-xs text-slate-400">
                                {task.unit === "grade" ? "학년별 제출" : "학반별 제출"} ·{" "}
                                {task.allowed_file_types
                                  .map((c) => FILE_CATEGORY_LABELS[c])
                                  .join(", ")}
                                {task.deadline &&
                                  ` · 마감 ${new Date(task.deadline).toLocaleString("ko-KR")}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/manager/tasks/${task.id}`}
                              className="text-sm font-medium text-brand-600 hover:underline"
                            >
                              관리
                            </Link>
                            <button
                              onClick={() => handleDelete(task.id)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>
    </div>
  );
}

export default function ManagerTasksPage() {
  return (
    <SchoolGate>
      <TasksInner />
    </SchoolGate>
  );
}
