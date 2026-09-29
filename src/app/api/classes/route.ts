import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/apiHandler";
import { ClassStructure } from "@/lib/types";

export const GET = withApiErrorHandling(async (req: NextRequest) => {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const year = req.nextUrl.searchParams.get("year");
  const semester = req.nextUrl.searchParams.get("semester");

  if (!schoolId) {
    return NextResponse.json({ error: "schoolId가 필요합니다." }, { status: 400 });
  }

  const conditions = ["school_id = $1"];
  const params: unknown[] = [schoolId];

  if (year) {
    params.push(Number(year));
    conditions.push(`year = $${params.length}`);
  }
  if (semester) {
    params.push(Number(semester));
    conditions.push(`semester = $${params.length}`);
  }

  const classStructures = await query<ClassStructure>(
    `select * from class_structures where ${conditions.join(" and ")} order by grade asc`,
    params
  );

  return NextResponse.json({ classStructures });
});

/** 학년별 학급 수를 upsert 합니다. body: { schoolId, year, semester, grades: [{grade, classCount}] } */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const { schoolId, year, semester, grades } = body as {
    schoolId: string;
    year: number;
    semester: number;
    grades: { grade: number; classCount: number }[];
  };

  if (!schoolId || !year || !semester || !Array.isArray(grades) || grades.length === 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const params: unknown[] = [];
  const valuesSql = grades
    .map((g) => {
      params.push(schoolId, year, semester, g.grade, g.classCount);
      const base = params.length - 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    })
    .join(", ");

  const classStructures = await query<ClassStructure>(
    `insert into class_structures (school_id, year, semester, grade, class_count)
     values ${valuesSql}
     on conflict (school_id, year, semester, grade)
     do update set class_count = excluded.class_count
     returning *`,
    params
  );

  return NextResponse.json({ classStructures });
});
