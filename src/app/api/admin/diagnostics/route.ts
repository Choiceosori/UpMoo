import { NextRequest, NextResponse } from "next/server";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { withApiErrorHandling } from "@/lib/apiHandler";
import { query } from "@/lib/db";

function isAdminAuthorized(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

/**
 * 네이버 클라우드 Cloud DB for PostgreSQL / Object Storage 연결 상태를 값 노출 없이
 * 직접 확인합니다(실제 쿼리/HeadBucket 호출). ADMIN_PASSWORD로 보호됩니다.
 */
export const GET = withApiErrorHandling(async (req: NextRequest) => {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  const result = {
    database: { configured: false, host: null as string | null, connected: false, error: null as string | null },
    storage: { configured: false, bucket: null as string | null, connected: false, error: null as string | null },
  };

  const databaseUrl = process.env.DATABASE_URL;
  result.database.configured = !!databaseUrl;
  if (databaseUrl) {
    try {
      result.database.host = new URL(databaseUrl).host;
    } catch {
      // URL 파싱 실패는 아래 연결 시도에서 자연스럽게 드러납니다.
    }
    try {
      await query("select 1");
      result.database.connected = true;
    } catch (err) {
      result.database.error = err instanceof Error ? err.message : "알 수 없는 오류";
    }
  }

  const accessKey = process.env.NCP_ACCESS_KEY;
  const secretKey = process.env.NCP_SECRET_KEY;
  const bucket = process.env.NCP_STORAGE_BUCKET;
  result.storage.configured = !!accessKey && !!secretKey && !!bucket;
  result.storage.bucket = bucket ?? null;

  if (result.storage.configured) {
    try {
      const client = new S3Client({
        region: process.env.NCP_OBJECT_STORAGE_REGION || "kr-standard",
        endpoint: process.env.NCP_OBJECT_STORAGE_ENDPOINT || "https://kr.object.ncloudstorage.com",
        forcePathStyle: true,
        credentials: { accessKeyId: accessKey!, secretAccessKey: secretKey! },
      });
      await client.send(new HeadBucketCommand({ Bucket: bucket! }));
      result.storage.connected = true;
    } catch (err) {
      result.storage.error = err instanceof Error ? err.message : "알 수 없는 오류";
    }
  }

  const verdictParts: string[] = [];
  if (!result.database.configured) {
    verdictParts.push("DATABASE_URL이 설정되지 않았습니다.");
  } else if (!result.database.connected) {
    verdictParts.push(
      `DB 연결 실패 (호스트: ${result.database.host ?? "?"}). ACG에서 이 서버의 접근을 허용했는지, 접속 정보가 정확한지 확인하세요.`
    );
  } else {
    verdictParts.push("DB 연결 정상.");
  }

  if (!result.storage.configured) {
    verdictParts.push("NCP_ACCESS_KEY/NCP_SECRET_KEY/NCP_STORAGE_BUCKET이 설정되지 않았습니다.");
  } else if (!result.storage.connected) {
    verdictParts.push(
      `Object Storage 연결 실패 (버킷: ${result.storage.bucket}). 인증키와 버킷 이름을 확인하세요.`
    );
  } else {
    verdictParts.push("Object Storage 연결 정상.");
  }

  return NextResponse.json({ ...result, verdict: verdictParts.join(" ") });
});
