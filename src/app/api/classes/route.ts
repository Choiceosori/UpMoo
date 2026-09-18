import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const year = req.nextUrl.searchParams.get("year");
  const semester = req.nextUrl.searchParams.get("semester");

  if (!schoolId) {
    return NextResponse.json({ error: "schoolId가 필요합니다." }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("class_structures")
    .select("*")
    .eq("school_id", schoolId)
    .order("grade", { ascending: true });

  if (year) query = query.eq("year", Number(year));
  if (semester) query = query.eq("semester", Number(semester));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ classStructures: data });
}

/** 학년별 학급 수를 upsert 합니다. body: { schoolId, year, semester, grades: [{grade, classCount}] } */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { schoolId, year, semester, grades } = body as {
    schoolId: string;
    year: number;
    semester: number;
    grades: { grade: number; classCount: number }[];
  };

  if (!schoolId || !year || !semester || !Array.isArray(grades)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const rows = grades.map((g) => ({
    school_id: schoolId,
    year,
    semester,
    grade: g.grade,
    class_count: g.classCount,
  }));

  const { data, error } = await supabaseAdmin
    .from("class_structures")
    .upsert(rows, { onConflict: "school_id,year,semester,grade" })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ classStructures: data });
}
