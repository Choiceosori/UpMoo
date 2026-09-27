import { NextRequest, NextResponse } from "next/server";

type RouteHandler<Context> = (req: NextRequest, context: Context) => Promise<NextResponse>;

/**
 * API Route 핸들러를 감싸 예기치 못한 예외(환경변수 미설정, 네트워크 오류 등)를
 * 사용자에게 원인을 알 수 있는 JSON 에러 응답으로 변환합니다.
 * 이 래퍼가 없으면 예외가 Next.js 기본 500 페이지로 이어져 브라우저/클라이언트에서
 * "TypeError: fetch failed"처럼 원인을 알 수 없는 메시지만 보이게 됩니다.
 */
export function withApiErrorHandling<Context = { params: Promise<Record<string, string>> }>(
  handler: RouteHandler<Context>
): RouteHandler<Context> {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      console.error("[API Error]", err);
      const message = err instanceof Error ? err.message : "서버 오류가 발생했습니다.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
