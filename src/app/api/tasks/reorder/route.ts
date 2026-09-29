import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";

/** body: { orderedTaskIds: string[] } - Drag & Drop 결과에 따른 순서 저장 */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const orderedTaskIds = body.orderedTaskIds as string[];

  if (!Array.isArray(orderedTaskIds) || orderedTaskIds.length === 0) {
    return NextResponse.json({ error: "orderedTaskIds가 필요합니다." }, { status: 400 });
  }

  await Promise.all(
    orderedTaskIds.map((id, index) =>
      query("update collection_tasks set position = $1 where id = $2", [index, id])
    )
  );

  return NextResponse.json({ ok: true });
});
