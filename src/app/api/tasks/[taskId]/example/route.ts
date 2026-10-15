import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { query, queryOne } from "@/lib/db";
import { getSignedDownloadUrl, removeObjects, uploadObject } from "@/lib/objectStorage";
import { extractExtension } from "@/lib/filename";
import { CollectionTask } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";

/** 제출자용: 업무에 첨부된 예시 양식 파일의 다운로드 URL을 조회합니다. */
export const GET = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (_req, { params }) => {
    const { taskId } = await params;
    const task = await queryOne<CollectionTask>(
      "select * from collection_tasks where id = $1",
      [taskId]
    );
    if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    if (!task.example_storage_path) {
      return NextResponse.json({ downloadUrl: null, filename: null });
    }
    const downloadUrl = await getSignedDownloadUrl(
      task.example_storage_path,
      60 * 10,
      task.example_filename ?? undefined
    );
    return NextResponse.json({ downloadUrl, filename: task.example_filename });
  }
);

/** 담당자용: 예시 양식 파일을 업로드(또는 교체)합니다. */
export const POST = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (req, { params }) => {
    const { taskId } = await params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    }

    const existing = await queryOne<CollectionTask>(
      "select * from collection_tasks where id = $1",
      [taskId]
    );
    if (!existing) {
      return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    }

    const storagePath = `${existing.school_id}/${taskId}/example_${randomUUID()}${extractExtension(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(storagePath, buffer, file.type || "application/octet-stream");

    if (existing.example_storage_path) {
      await removeObjects([existing.example_storage_path]);
    }

    const task = await queryOne<CollectionTask>(
      `update collection_tasks
       set example_storage_path = $1, example_filename = $2
       where id = $3
       returning *`,
      [storagePath, file.name, taskId]
    );

    return NextResponse.json({ task });
  }
);

/** 담당자용: 예시 양식 파일을 제거합니다. */
export const DELETE = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (_req, { params }) => {
    const { taskId } = await params;
    const existing = await queryOne<CollectionTask>(
      "select example_storage_path from collection_tasks where id = $1",
      [taskId]
    );

    if (existing?.example_storage_path) {
      await removeObjects([existing.example_storage_path]);
    }

    await query(
      "update collection_tasks set example_storage_path = null, example_filename = null where id = $1",
      [taskId]
    );

    return NextResponse.json({ ok: true });
  }
);
