import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { query, queryOne } from "@/lib/db";
import { getSignedDownloadUrl, removeObjects, uploadObject } from "@/lib/ncpStorage";
import { buildSubmissionFilename, extractExtension } from "@/lib/filename";
import { Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";

export const GET = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (_req, { params }) => {
    const { id } = await params;
    const submission = await queryOne<Submission>("select * from submissions where id = $1", [
      id,
    ]);

    if (!submission) {
      return NextResponse.json({ error: "제출 자료를 찾을 수 없습니다." }, { status: 404 });
    }

    const downloadUrl = await getSignedDownloadUrl(
      submission.storage_path,
      60 * 10,
      submission.stored_filename
    );

    return NextResponse.json({ submission, downloadUrl });
  }
);

/** 제출자가 본인 자료를 수정/재업로드 할 때 사용 (파일 교체) */
export const PATCH = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const piiFlagged = formData.get("piiFlagged");
    const expenseFlagged = formData.get("expenseFlagged");

    const existing = await queryOne<
      Submission & { task_name: string; task_unit: "grade" | "class" }
    >(
      `select s.*, t.name as task_name, t.unit as task_unit
       from submissions s
       join collection_tasks t on t.id = s.task_id
       where s.id = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json({ error: "제출 자료를 찾을 수 없습니다." }, { status: 404 });
    }

    const columns: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (file) {
      const storedFilename = buildSubmissionFilename({
        unit: existing.task_unit,
        grade: existing.grade,
        classNo: existing.class_no,
        taskName: existing.task_name,
        originalFilename: file.name,
      });
      const newStoragePath = `${existing.school_id}/${existing.task_id}/${Date.now()}_${randomUUID()}${extractExtension(file.name)}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      await uploadObject(newStoragePath, buffer, file.type || "application/octet-stream");
      await removeObjects([existing.storage_path]);

      columns.original_filename = file.name;
      columns.stored_filename = storedFilename;
      columns.storage_path = newStoragePath;
      columns.size_bytes = buffer.byteLength;
    }

    if (piiFlagged !== null) columns.pii_flagged = piiFlagged === "true";
    if (expenseFlagged !== null) columns.expense_flagged = expenseFlagged === "true";

    const keys = Object.keys(columns);
    const setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
    const sqlParams = [...keys.map((key) => columns[key]), id];

    const updated = await queryOne<Submission>(
      `update submissions set ${setClause} where id = $${sqlParams.length} returning *`,
      sqlParams
    );

    return NextResponse.json({ submission: updated });
  }
);

export const DELETE = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (_req, { params }) => {
    const { id } = await params;
    const existing = await queryOne<Submission>(
      "select storage_path from submissions where id = $1",
      [id]
    );

    if (existing) {
      await removeObjects([existing.storage_path]);
    }

    await query("delete from submissions where id = $1", [id]);
    return NextResponse.json({ ok: true });
  }
);
