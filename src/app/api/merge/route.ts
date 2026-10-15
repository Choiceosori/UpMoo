import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { downloadObject } from "@/lib/objectStorage";
import { mergeGeneralExcel } from "@/lib/excel/mergeGeneral";
import { mergeExpenseExcel } from "@/lib/excel/mergeExpense";
import { mergePdfFiles } from "@/lib/mergePdf";
import { CollectionTask, Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

type MergeCategory = "excel_general" | "excel_expense" | "pdf";

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
};

function labelFor(sub: Submission): string {
  return sub.class_no ? `${sub.grade}학년_${sub.class_no}반` : `${sub.grade}학년`;
}

/**
 * 담당자가 "통합 파일 수합"을 클릭했을 때 호출되는 엔드포인트.
 * body: { taskId: string, category: "excel_general" | "excel_expense" | "pdf" }
 * 응답: 병합된 단일 파일 (다운로드용 스트림)
 *
 * - excel_general: 시트별로 분리/추가하여 하나의 워크북으로 병합
 * - excel_expense: 동일 양식 데이터를 기존 데이터 하단에 Append
 * - pdf: 제출 순서(학년/반 순)대로 페이지를 이어 붙여 하나의 PDF로 병합
 *
 * HWP/HWPX는 한컴의 독점 포맷이라 공개 라이브러리로 내용을 이어 붙일 수 없어
 * 이 엔드포인트에서는 지원하지 않습니다(대신 /api/zip으로 모아받을 수 있습니다).
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

  const inputs = await Promise.all(
    submissions.map(async (sub) => {
      const buffer = await downloadObject(sub.storage_path);
      return { label: labelFor(sub), buffer };
    })
  );

  let mergedBuffer: Buffer;
  try {
    if (category === "excel_general") {
      mergedBuffer = await mergeGeneralExcel(inputs);
    } else if (category === "excel_expense") {
      mergedBuffer = await mergeExpenseExcel(inputs);
    } else {
      mergedBuffer = await mergePdfFiles(inputs);
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
