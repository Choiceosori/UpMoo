"use client";

interface WarningModalProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
}

/** 개인정보 검출 / 지출 엑셀 양식 오류 등 공통 경고 팝업 */
export function WarningModal({
  open,
  title,
  message,
  onConfirm,
  confirmLabel = "확인했습니다",
}: WarningModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onConfirm}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
