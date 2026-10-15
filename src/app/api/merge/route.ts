import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { downloadObject, getSignedDownloadUrl } from "@/lib/objectStorage";
import { mergeGeneralExcel } from "@/lib/excel/mergeGeneral";
import { mergeExpenseExcel } from "@/lib/excel/mergeExpense";
import { mergePdfFiles } from "@/lib/mergePdf";
import { mergeHwpFiles } from "@/lib/mergeHwp";
import { CollectionTask, Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

type MergeCategory = "excel_general" | "excel_expense" | "pdf" | "hwp";

const MERGE_OUTPUT: Record<MergeCategory, { suffix: string; ext: string; contentType: string }> = {
  excel_general: {
    suffix: "통합(일반)",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  excel_expense: {
    suffix: "통합(지출)",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pdf: { suffix: "통합", ext: "pdf", contentType: "application/pdf" },
  hwp: { suffix: "통합", ext: "hwp", contentType: "application/x-hwp" },
};

function labelFor(sub: Submission): string {
  return sub.class_no ? `${sub.grade}학년_${sub.class_no}반` : `${sub.grade}학년`;
}

/**
 * 담당자가 "통합 파일 수합"을 클릭했을 때 호출되는 엔드포인트.
 * body: { taskId: string, category: "excel_general" | "excel_expense" | "pdf" | "hwp" }
 * 응답: 병합된 단일 파일 (다운로드용 스트림)
 *
 * - excel_general: 시트별로 분리/추가하여 하나의 워크북으로 병합
 * - excel_expense: 동일 양식 데이터를 기존 데이터 하단에 Append
 * - pdf: 제출 순서(학년/반 순)대로 페이지를 이어 붙여 하나의 PDF로 병합
 * - hwp: api/hwp_merge.py(Vercel Python 함수)를 호출해 BodyText 섹션을 이어
 *   붙입니다(lib/mergeHwp.ts 주석의 best-effort 한계 참고).
 */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const { taskId, category } = body as { taskId: string; category: MergeCategory };

  if (!taskId || !category) {
    return NextResponse.json({ error: "taskId와 category가 필요합니다." }, { status: 400 });
  }
  if (!(category in MERGE_OUTPUT)) {
    return NextResponse.json({ error: "지원하지 않는 category 입니다." }, { status: 400 });
  }

  const task = await queryOne<CollectionTask>(
    "select * from collection_tasks where id = $1",
    [taskId]
  );

  if (!task) {
    return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
  }

  const submissions = await query<Submission>(
    `select * from submissions
     where task_id = $1 and file_category = $2
     order by grade asc, class_no asc nulls first`,
    [taskId, category]
  );

  if (submissions.length === 0) {
    return NextResponse.json({ error: "병합할 제출 자료가 없습니다." }, { status: 404 });
  }

  let mergedBuffer: Buffer;
  try {
    if (category === "hwp") {
      // HWP는 파일 내용을 직접 내려받지 않고, Python 병합 함수가 R2에서
      // 직접 받아갈 수 있도록 서명 URL만 넘깁니다 (lib/mergeHwp.ts 주석 참고
      // — Vercel 함수의 ~4.5MB 바디 한도를 피하기 위함).
      const hwpInputs = await Promise.all(
        submissions.map(async (sub) => ({
          label: labelFor(sub),
          url: await getSignedDownloadUrl(sub.storage_path, 300),
        }))
      );
      mergedBuffer = await mergeHwpFiles(hwpInputs, req.nextUrl.origin);
    } else {
      const inputs = await Promise.all(
        submissions.map(async (sub) => {
          const buffer = await downloadObject(sub.storage_path);
          return { label: labelFor(sub), buffer };
        })
      );
      if (category === "excel_general") {
        mergedBuffer = await mergeGeneralExcel(inputs);
      } else if (category === "excel_expense") {
        mergedBuffer = await mergeExpenseExcel(inputs);
      } else {
        mergedBuffer = await mergePdfFiles(inputs);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "병합 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { suffix, ext, contentType } = MERGE_OUTPUT[category];
  const filename = encodeURIComponent(`${task.name}_${suffix}.${ext}`);

  return new NextResponse(new Uint8Array(mergedBuffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Content-Length": String(mergedBuffer.byteLength),
    },
  });
});
