import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.HWP_MERGE_WORKER_SECRET;
  if (!secret) return true;
  return req.headers.get("x-merge-secret") === secret;
}

/**
 * Windows HWP 병합 워커가 작업을 끝낸 뒤(성공/실패 모두) 호출합니다.
 * body: { ok: true } | { ok: false, error: string }
 * 병합 결과 파일 자체는 워커가 이미 작업 생성 시 받은 서명 PUT URL로 R2에
 * 직접 업로드했으므로, 여기서는 상태만 기록합니다.
 */
export const POST = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: "인증에 실패했습니다." }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const ok = body?.ok === true;
    const errorMessage = typeof body?.error === "string" ? body.error.slice(0, 2000) : null;

    await query(
      `update hwp_merge_jobs
       set status = $2, error = $3, completed_at = now()
       where id = $1`,
      [id, ok ? "done" : "error", errorMessage]
    );

    return NextResponse.json({ ok: true });
  }
);
