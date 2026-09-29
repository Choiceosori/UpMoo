import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { query, queryOne } from "@/lib/db";
import { uploadObject } from "@/lib/ncpStorage";
import { buildSubmissionFilename, extractExtension } from "@/lib/filename";
import { CollectionTask, FileCategory, Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";

export const GET = withApiErrorHandling(async (req: NextRequest) => {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const taskId = req.nextUrl.searchParams.get("taskId");
  const grade = req.nextUrl.searchParams.get("grade");
  const classNo = req.nextUrl.searchParams.get("classNo");

  if (!schoolId) {
    return NextResponse.json({ error: "schoolId가 필요합니다." }, { status: 400 });
  }

  const conditions = ["school_id = $1"];
  const params: unknown[] = [schoolId];

  if (taskId) {
    params.push(taskId);
    conditions.push(`task_id = $${params.length}`);
  }
  if (grade) {
    params.push(Number(grade));
    conditions.push(`grade = $${params.length}`);
  }
  if (classNo) {
    params.push(Number(classNo));
    conditions.push(`class_no = $${params.length}`);
  }

  const submissions = await query<Submission>(
    `select * from submissions where ${conditions.join(" and ")} order by created_at asc`,
    params
  );

  return NextResponse.json({ submissions });
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const formData = await req.formData();

  const schoolId = String(formData.get("schoolId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const grade = Number(formData.get("grade"));
  const classNoRaw = formData.get("classNo");
  const classNo = classNoRaw ? Number(classNoRaw) : null;
  const fileCategory = String(formData.get("fileCategory") ?? "") as FileCategory;
  const piiFlagged = formData.get("piiFlagged") === "true";
  const expenseFlagged = formData.get("expenseFlagged") === "true";
  const file = formData.get("file") as File | null;

  if (!schoolId || !taskId || !grade || !fileCategory || !file) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const task = await queryOne<CollectionTask>(
    "select * from collection_tasks where id = $1",
    [taskId]
  );

  if (!task) {
    return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
  }

  const storedFilename = buildSubmissionFilename({
    unit: task.unit,
    grade,
    classNo,
    taskName: task.name,
    originalFilename: file.name,
  });

  // Object Storage의 오브젝트 키는 한글/공백 등이 포함되면 거부될 수 있으므로,
  // 실제 저장 경로는 ASCII로만 구성하고 사람이 읽는 파일명은 stored_filename 컬럼에 별도 보관합니다.
  const storagePath = `${schoolId}/${taskId}/${Date.now()}_${randomUUID()}${extractExtension(file.name)}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await uploadObject(storagePath, buffer, file.type || "application/octet-stream");

  const submission = await queryOne<Submission>(
    `insert into submissions
       (school_id, task_id, grade, class_no, file_category, original_filename,
        stored_filename, storage_path, size_bytes, pii_flagged, expense_flagged)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      schoolId,
      taskId,
      grade,
      classNo,
      fileCategory,
      file.name,
      storedFilename,
      storagePath,
      buffer.byteLength,
      piiFlagged,
      expenseFlagged,
    ]
  );

  return NextResponse.json({ submission }, { status: 201 });
});
