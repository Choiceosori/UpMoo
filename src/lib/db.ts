import { Pool, QueryResultRow } from "pg";

// Vercel 서버리스 함수는 요청마다 새 인스턴스가 뜰 수 있으므로, 커넥션 풀을 모듈
// 전역에 캐시해 warm 상태에서는 재사용하고 max를 낮게 잡아 DB의 동시 접속 제한을
// 넘지 않도록 합니다. Neon처럼 서버리스에 최적화된 Postgres는 자체 커넥션 풀러
// (pooled connection string, 호스트명에 "-pooler"가 붙은 형태)를 제공하니 가능하면
// 그 연결 문자열을 DATABASE_URL로 사용하세요.
let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL 환경변수가 설정되지 않았습니다. Postgres 접속 정보를 " +
        "postgresql://<user>:<password>@<host>/<database>?sslmode=require 형식으로 등록한 뒤 다시 배포해주세요."
    );
  }

  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl:
      process.env.DATABASE_SSL === "false"
        ? undefined
        : // 일부 관리형 Postgres는 자체 서명 인증서를 사용하는 경우가 있어
          // 별도 CA 등록 없이도 연결되도록 인증서 검증을 완화합니다.
          { rejectUnauthorized: false },
  });

  pool.on("error", (err) => {
    console.error("[db] idle client error", err);
  });

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
