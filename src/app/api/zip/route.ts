import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { query, queryOne } from "@/lib/db";
import { downloadObject } from "@/lib/objectStorage";
import { CollectionTask, Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let suffix = 2;
  let candidate = `${base}_${suffix}${ext}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * 업무에 제출된 모든 파일(HWP/PDF/엑셀 등 종류 무관)을 하나의 ZIP으로 묶어
 * 다운로드합니다. body: { taskId: string }
 */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const { taskId } = body as { taskId: string };

  if (!taskId) {
    return NextResponse.json({ error: "taskId가 필요합니다." }, { status: 400 });
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
     where task_id = $1
     order by grade asc, class_no asc nulls first`,
    [taskId]
  );

  if (submissions.length === 0) {
    return NextResponse.json({ error: "제출된 자료가 없습니다." }, { status: 404 });
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();

  await Promise.all(
    submissions.map(async (sub) => {
      const buffer = await downloadObject(sub.storage_path);
      const name = uniqueName(sub.stored_filename, usedNames);
      zip.file(name, buffer);
    })
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const filename = encodeURIComponent(`${task.name}_전체파일.zip`);

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Content-Length": String(zipBuffer.byteLength),
    },
  });
});
