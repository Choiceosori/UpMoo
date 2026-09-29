import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";
import { CollectionTask, FileCategory, SubmissionUnit } from "@/lib/types";

export const GET = withApiErrorHandling(async (req: NextRequest) => {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  if (!schoolId) {
    return NextResponse.json({ error: "schoolId가 필요합니다." }, { status: 400 });
  }

  const tasks = await query<CollectionTask>(
    "select * from collection_tasks where school_id = $1 order by position asc",
    [schoolId]
  );

  return NextResponse.json({ tasks });
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const {
    schoolId,
    name,
    description,
    deadline,
    unit,
    allowedFileTypes,
  } = body as {
    schoolId: string;
    name: string;
    description?: string;
    deadline?: string;
    unit: SubmissionUnit;
    allowedFileTypes: FileCategory[];
  };

  if (!schoolId || !name?.trim() || !unit || !allowedFileTypes?.length) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const countRow = await queryOne<{ count: string }>(
    "select count(*) from collection_tasks where school_id = $1",
    [schoolId]
  );
  const position = Number(countRow?.count ?? 0);

  const task = await queryOne<CollectionTask>(
    `insert into collection_tasks
       (school_id, name, description, deadline, unit, allowed_file_types, position)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      schoolId,
      name.trim(),
      description?.trim() || null,
      deadline || null,
      unit,
      allowedFileTypes,
      position,
    ]
  );

  return NextResponse.json({ task }, { status: 201 });
});
