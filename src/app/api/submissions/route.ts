import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, SUBMISSIONS_BUCKET } from "@/lib/supabaseAdmin";
import { buildSubmissionFilename } from "@/lib/filename";
import { FileCategory } from "@/lib/types";
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

  let query = supabaseAdmin
    .from("submissions")
    .select("*")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: true });

  if (taskId) query = query.eq("task_id", taskId);
  if (grade) query = query.eq("grade", Number(grade));
  if (classNo) query = query.eq("class_no", Number(classNo));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submissions: data });
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

  const { data: task, error: taskError } = await supabaseAdmin
    .from("collection_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
  }

  const storedFilename = buildSubmissionFilename({
    unit: task.unit,
    grade,
    classNo,
    taskName: task.name,
    originalFilename: file.name,
  });

  const storagePath = `${schoolId}/${taskId}/${Date.now()}_${storedFilename}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(SUBMISSIONS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: submission, error: insertError } = await supabaseAdmin
    .from("submissions")
    .insert({
      school_id: schoolId,
      task_id: taskId,
      grade,
      class_no: classNo,
      file_category: fileCategory,
      original_filename: file.name,
      stored_filename: storedFilename,
      storage_path: storagePath,
      size_bytes: buffer.byteLength,
      pii_flagged: piiFlagged,
      expense_flagged: expenseFlagged,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ submission }, { status: 201 });
});
