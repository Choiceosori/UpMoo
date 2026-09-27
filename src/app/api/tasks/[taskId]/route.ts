import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withApiErrorHandling } from "@/lib/apiHandler";

export const GET = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (_req, { params }) => {
    const { taskId } = await params;
    const { data, error } = await supabaseAdmin
      .from("collection_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ task: data });
  }
);

export const PATCH = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (req, { params }) => {
    const { taskId } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.deadline !== undefined) updates.deadline = body.deadline || null;
    if (body.unit !== undefined) updates.unit = body.unit;
    if (body.allowedFileTypes !== undefined) updates.allowed_file_types = body.allowedFileTypes;

    const { data, error } = await supabaseAdmin
      .from("collection_tasks")
      .update(updates)
      .eq("id", taskId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ task: data });
  }
);

export const DELETE = withApiErrorHandling<{ params: Promise<{ taskId: string }> }>(
  async (_req, { params }) => {
    const { taskId } = await params;
    const { error } = await supabaseAdmin.from("collection_tasks").delete().eq("id", taskId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
);
