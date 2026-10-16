import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";

interface JobRow {
  id: string;
  urls: string[];
  upload_url: string;
}

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.HWP_MERGE_WORKER_SECRET;
  if (!secret) return true; // 설정 안 했으면 인증 생략(로컬 테스트용) — 운영에서는 꼭 설정하세요.
  return req.headers.get("x-merge-secret") === secret;
}

/**
 * Windows HWP 병합 워커(windows-hwp-service/server.py)가 계속 폴링하는
 * 엔드포인트입니다. 대기 중인 작업이 있으면 하나를 "processing"으로 선점해서
 * 돌려주고, 없으면 { job: null }을 돌려줍니다.
 *
 * `for update skip locked`로 여러 워커가 동시에 폴링해도 같은 작업을 중복으로
 * 가져가지 않습니다. 워커가 죽어서 완료 보고 없이 2분 넘게 processing 상태로
 * 멈춰있는 작업은 다시 pending으로 되돌려 다른(또는 재시작된) 워커가 재시도할
 * 수 있게 합니다.
 */
export const GET = withApiErrorHandling(async (req: NextRequest) => {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "인증에 실패했습니다." }, { status: 401 });
  }

  await query(
    `update hwp_merge_jobs
     set status = 'pending', claimed_at = null
     where status = 'processing' and claimed_at < now() - interval '2 minutes'`
  );

  const job = await queryOne<JobRow>(
    `update hwp_merge_jobs
     set status = 'processing', claimed_at = now()
     where id = (
       select id from hwp_merge_jobs
       where status = 'pending'
       order by created_at asc
       limit 1
       for update skip locked
     )
     returning id, urls, upload_url`
  );

  if (!job) {
    return NextResponse.json({ job: null });
  }

  return NextResponse.json({
    job: { id: job.id, urls: job.urls, uploadUrl: job.upload_url },
  });
});
