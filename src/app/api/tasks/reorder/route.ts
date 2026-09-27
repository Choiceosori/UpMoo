import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withApiErrorHandling } from "@/lib/apiHandler";

/** body: { orderedTaskIds: string[] } - Drag & Drop 결과에 따른 순서 저장 */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const orderedTaskIds = body.orderedTaskIds as string[];

  if (!Array.isArray(orderedTaskIds) || orderedTaskIds.length === 0) {
    return NextResponse.json({ error: "orderedTaskIds가 필요합니다." }, { status: 400 });
  }

  const updates = orderedTaskIds.map((id, index) =>
    supabaseAdmin.from("collection_tasks").update({ position: index }).eq("id", id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
});
