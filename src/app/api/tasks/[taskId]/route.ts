import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";
import { CollectionTask } from "@/lib/types";

export const GET = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (_req, { params }) => {
    const { taskId } = await params;
    const task = await queryOne<CollectionTask>(
      "select * from collection_tasks where id = $1",
      [taskId]
    );
    if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ task });
  }
);

export const PATCH = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (req, { params }) => {
    const { taskId } = await params;
    const body = await req.json();

    const columns: Record<string, unknown> = {};
    if (body.name !== undefined) columns.name = String(body.name).trim();
    if (body.description !== undefined) columns.description = body.description?.trim() || null;
    if (body.deadline !== undefined) columns.deadline = body.deadline || null;
    if (body.unit !== undefined) columns.unit = body.unit;
    if (body.allowedFileTypes !== undefined) columns.allowed_file_types = body.allowedFileTypes;

    const keys = Object.keys(columns);
    if (keys.length === 0) {
      const task = await queryOne<CollectionTask>(
        "select * from collection_tasks where id = $1",
        [taskId]
      );
      return NextResponse.json({ task });
    }

    const setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
    const sqlParams = [...keys.map((key) => columns[key]), taskId];

    const task = await queryOne<CollectionTask>(
      `update collection_tasks set ${setClause} where id = $${sqlParams.length} returning *`,
      sqlParams
    );

    return NextResponse.json({ task });
  }
);

export const DELETE = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (_req, { params }) => {
    const { taskId } = await params;
    await query("delete from collection_tasks where id = $1", [taskId]);
    return NextResponse.json({ ok: true });
  }
);
