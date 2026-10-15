import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { Submission } from "@/lib/types";
import { withApiErrorHandling } from "@/lib/apiHandler";

/** 담당자가 특정 제출 건에 수정을 요청합니다. body: { message: string } */
export const POST = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const { id } = await params;
    const body = await req.json();
    const message = String(body.message ?? "").trim();

    if (!message) {
      return NextResponse.json({ error: "수정 요청 메시지를 입력해주세요." }, { status: 400 });
    }

    const submission = await queryOne<Submission>(
      `update submissions
       set correction_requested = true, correction_message = $1
       where id = $2
       returning *`,
      [message, id]
    );

    if (!submission) {
      return NextResponse.json({ error: "제출 자료를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ submission });
  }
);

/** 담당자가 수정 요청을 직접 해제합니다(제출자가 재업로드하면 자동으로도 해제됩니다). */
export const DELETE = withApiErrorHandling<{ params: Promise<{ id: string }> }>(
  async (_req, { params }) => {
    const { id } = await params;
    const submission = await queryOne<Submission>(
      `update submissions
       set correction_requested = false, correction_message = null
       where id = $1
       returning *`,
      [id]
    );

    if (!submission) {
      return NextResponse.json({ error: "제출 자료를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ submission });
  }
);
