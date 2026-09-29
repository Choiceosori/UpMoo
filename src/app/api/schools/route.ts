import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";
import { School } from "@/lib/types";

function isAdminAuthorized(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

function generateSchoolCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export const GET = withApiErrorHandling(async (req: NextRequest) => {
  const code = req.nextUrl.searchParams.get("code");

  const schools = code
    ? await query<School>("select * from schools where code = $1", [code.toUpperCase()])
    : await query<School>("select * from schools order by created_at desc");

  return NextResponse.json({ schools });
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "학교명을 입력해주세요." }, { status: 400 });
  }

  // 코드 충돌(극히 드묾) 시 재시도합니다.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateSchoolCode();
    try {
      const school = await queryOne<School>(
        "insert into schools (name, code) values ($1, $2) returning *",
        [name, code]
      );
      return NextResponse.json({ school }, { status: 201 });
    } catch (err) {
      const isUniqueViolation =
        err instanceof Error && (err as { code?: string }).code === "23505";
      if (!isUniqueViolation) throw err;
    }
  }

  return NextResponse.json(
    { error: "학교 코드를 발급하지 못했습니다. 다시 시도해주세요." },
    { status: 500 }
  );
});
