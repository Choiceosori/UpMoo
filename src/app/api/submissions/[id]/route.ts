import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, SUBMISSIONS_BUCKET } from "@/lib/supabaseAdmin";
import { buildSubmissionFilename } from "@/lib/filename";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("submissions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: signedUrl } = await supabaseAdmin.storage
    .from(SUBMISSIONS_BUCKET)
    .createSignedUrl(data.storage_path, 60 * 10);

  return NextResponse.json({ submission: data, downloadUrl: signedUrl?.signedUrl ?? null });
}

/** 제출자가 본인 자료를 수정/재업로드 할 때 사용 (파일 교체) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const piiFlagged = formData.get("piiFlagged");
  const expenseFlagged = formData.get("expenseFlagged");

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("submissions")
    .select("*, collection_tasks(name, unit)")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "제출 자료를 찾을 수 없습니다." }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (file) {
    const taskInfo = existing.collection_tasks as unknown as
      | { name: string; unit: "grade" | "class" }
      | undefined;
    const storedFilename = buildSubmissionFilename({
      unit: taskInfo?.unit ?? "class",
      grade: existing.grade,
      classNo: existing.class_no,
      taskName: taskInfo?.name ?? "업무",
      originalFilename: file.name,
    });
    const newStoragePath = `${existing.school_id}/${existing.task_id}/${Date.now()}_${storedFilename}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(SUBMISSIONS_BUCKET)
      .upload(newStoragePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    await supabaseAdmin.storage.from(SUBMISSIONS_BUCKET).remove([existing.storage_path]);

    updates.original_filename = file.name;
    updates.stored_filename = storedFilename;
    updates.storage_path = newStoragePath;
    updates.size_bytes = buffer.byteLength;
  }

  if (piiFlagged !== null) updates.pii_flagged = piiFlagged === "true";
  if (expenseFlagged !== null) updates.expense_flagged = expenseFlagged === "true";

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("submissions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ submission: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: existing } = await supabaseAdmin
    .from("submissions")
    .select("storage_path")
    .eq("id", id)
    .single();

  if (existing) {
    await supabaseAdmin.storage.from(SUBMISSIONS_BUCKET).remove([existing.storage_path]);
  }

  const { error } = await supabaseAdmin.from("submissions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
