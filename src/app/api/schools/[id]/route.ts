import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";

function isAdminAuthorized(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

export const DELETE = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    if (!isAdminAuthorized(req)) {
      return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    await query("delete from schools where id = $1", [id]);
    return NextResponse.json({ ok: true });
  }
);
