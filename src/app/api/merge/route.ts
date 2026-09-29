import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { downloadObject } from "@/lib/ncpStorage";
import { mergeGeneralExcel } from "@/lib/excel/mergeGeneral";
import { mergeExpenseExcel } from "@/lib/excel/mergeExpense";
import { CollectionTask, Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

function labelFor(sub: Submission): string {
  return sub.class_no ? `${sub.grade}학년_${sub.class_no}반` : `${sub.grade}학년`;
}

/**
 * 담당자가 "통합 파일 수합"을 클릭했을 때 호출되는 엔드포인트.
 * body: { taskId: string, category: "excel_general" | "excel_expense" }
 * 응답: 병합된 단일 엑셀 파일 (다운로드용 스트림)
 */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const { taskId, category } = body as {
    taskId: string;
    category: "excel_general" | "excel_expense";
  };

  if (!taskId || !category) {
    return NextResponse.json({ error: "taskId와 category가 필요합니다." }, { status: 400 });
  }
  if (category !== "excel_general" && category !== "excel_expense") {
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
    mergedBuffer =
      category === "excel_general"
        ? await mergeGeneralExcel(inputs)
        : await mergeExpenseExcel(inputs);
  } catch (err) {
    const message = err instanceof Error ? err.message : "병합 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const suffix = category === "excel_general" ? "통합(일반)" : "통합(지출)";
  const filename = encodeURIComponent(`${task.name}_${suffix}.xlsx`);

  return new NextResponse(new Uint8Array(mergedBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Content-Length": String(mergedBuffer.byteLength),
    },
  });
});
