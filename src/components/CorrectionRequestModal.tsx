"use client";

import { useState } from "react";

export const CORRECTION_CATEGORIES = [
  "양식 미준수",
  "개인정보 노출",
  "내용 누락",
  "오탈자/오류",
  "잘못된 파일 제출",
  "기타",
] as const;

interface CorrectionRequestModalProps {
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (category: string, detail: string) => void;
}

/** 담당자가 특정 제출 건에 수정을 요청할 때 쓰는 입력 폼 (수정 관련 사항 + 선택적 수정 방향) */
export function CorrectionRequestModal({
  open,
  submitting,
  onCancel,
  onSubmit,
}: CorrectionRequestModalProps) {
  const [category, setCategory] = useState<string>(CORRECTION_CATEGORIES[0]);
  const [detail, setDetail] = useState("");

  if (!open) return null;

  const handleSubmit = () => {
    onSubmit(category, detail.trim());
    setDetail("");
    setCategory(CORRECTION_CATEGORIES[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-900">수정 요청</h3>
        <p className="mt-1 text-sm text-slate-500">
          제출자의 자료 제출 화면에 바로 표시됩니다.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label">수정 관련 사항</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CORRECTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">수정 방향 (선택)</label>
            <textarea
              className="input"
              rows={3}
              placeholder="제출자에게 구체적으로 안내할 내용을 적어주세요 (선택 사항입니다)"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary" disabled={submitting}>
            취소
          </button>
          <button onClick={handleSubmit} className="btn-primary" disabled={submitting}>
            {submitting ? "요청 중..." : "수정 요청 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
