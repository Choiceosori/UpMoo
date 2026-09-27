import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withApiErrorHandling } from "@/lib/apiHandler";
import { FileCategory, SubmissionUnit } from "@/lib/types";

export const GET = withApiErrorHandling(async (req: NextRequest) => {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  if (!schoolId) {
    return NextResponse.json({ error: "schoolId가 필요합니다." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("collection_tasks")
    .select("*")
    .eq("school_id", schoolId)
    .order("position", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
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

  const { count } = await supabaseAdmin
    .from("collection_tasks")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId);

  const { data, error } = await supabaseAdmin
    .from("collection_tasks")
    .insert({
      school_id: schoolId,
      name: name.trim(),
      description: description?.trim() || null,
      deadline: deadline || null,
      unit,
      allowed_file_types: allowedFileTypes,
      position: count ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data }, { status: 201 });
});
