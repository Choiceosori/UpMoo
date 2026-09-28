import { NextRequest, NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiHandler";

function isAdminAuthorized(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

function decodeJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
    const payload = JSON.parse(payloadJson);
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * SUPABASE_SERVICE_ROLE_KEY가 실제로 service_role 권한의 키인지, 아니면
 * 실수로 anon/publishable 키가 들어가 있는지를 값을 노출하지 않고 진단합니다.
 * ADMIN_PASSWORD로 보호되며, 실제 키 값은 응답에 절대 포함하지 않습니다.
 */
export const GET = withApiErrorHandling(async (req: NextRequest) => {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const result: {
    supabaseUrlConfigured: boolean;
    supabaseUrlHost: string | null;
    serviceRoleKeyConfigured: boolean;
    serviceRoleKeyFormat: string;
    serviceRoleKeyRoleClaim: string | null;
    verdict: string;
  } = {
    supabaseUrlConfigured: !!url,
    supabaseUrlHost: null,
    serviceRoleKeyConfigured: !!key,
    serviceRoleKeyFormat: "unknown",
    serviceRoleKeyRoleClaim: null,
    verdict: "",
  };

  if (url) {
    try {
      result.supabaseUrlHost = new URL(url).host;
    } catch {
      result.verdict = "SUPABASE_URL이 올바른 URL 형식이 아닙니다.";
    }
  }

  if (key) {
    if (key.startsWith("sb_secret_")) {
      result.serviceRoleKeyFormat = "new-secret (정상)";
    } else if (key.startsWith("sb_publishable_")) {
      result.serviceRoleKeyFormat = "new-publishable (잘못됨 - anon 키)";
    } else if (key.split(".").length === 3) {
      result.serviceRoleKeyFormat = "legacy-jwt";
      result.serviceRoleKeyRoleClaim = decodeJwtRole(key);
    }
  }

  if (!result.supabaseUrlConfigured || !result.serviceRoleKeyConfigured) {
    result.verdict = "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.";
  } else if (result.serviceRoleKeyFormat === "new-secret (정상)") {
    result.verdict = "정상: service_role(secret) 키가 올바르게 설정되어 있습니다.";
  } else if (result.serviceRoleKeyFormat === "new-publishable (잘못됨 - anon 키)") {
    result.verdict =
      "문제 발견: publishable(anon) 키가 들어가 있습니다. Supabase 대시보드에서 'secret' 키로 교체해주세요.";
  } else if (result.serviceRoleKeyFormat === "legacy-jwt") {
    if (result.serviceRoleKeyRoleClaim === "service_role") {
      result.verdict = "정상: service_role 키가 올바르게 설정되어 있습니다.";
    } else if (result.serviceRoleKeyRoleClaim === "anon") {
      result.verdict =
        "문제 발견: anon 키가 service_role 키 자리에 들어가 있습니다. Supabase 대시보드 > Project Settings > API에서 'service_role secret' 키로 교체해주세요.";
    } else {
      result.verdict = `알 수 없는 role(${result.serviceRoleKeyRoleClaim ?? "확인 불가"})의 키입니다. service_role 키가 맞는지 확인해주세요.`;
    }
  } else {
    result.verdict =
      "키 형식을 인식할 수 없습니다. 값 앞뒤에 공백/줄바꿈이 포함되지 않았는지, 전체 키가 잘리지 않고 복사됐는지 확인해주세요.";
  }

  return NextResponse.json(result);
});
