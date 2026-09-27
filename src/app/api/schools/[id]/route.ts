import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
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
    const { error } = await supabaseAdmin.from("schools").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
);
