import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isAdminAuthorized(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

function generateSchoolCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  let query = supabaseAdmin.from("schools").select("*").order("created_at", { ascending: false });
  if (code) {
    query = supabaseAdmin.from("schools").select("*").eq("code", code.toUpperCase());
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ schools: data });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "학교명을 입력해주세요." }, { status: 400 });
  }

  const code = generateSchoolCode();
  const { data, error } = await supabaseAdmin
    .from("schools")
    .insert({ name, code })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ school: data }, { status: 201 });
}
