import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Next.js는 빌드 시 "Collecting page data" 단계에서 모든 API 라우트 모듈을 로드해
// 정적 분석을 수행합니다. 이 시점에는 Vercel 환경변수가 아직 주입되지 않았을 수 있으므로,
// 모듈 로드 시점에 즉시 클라이언트를 생성하면 SUPABASE_URL이 비어있을 때 빌드 자체가
// 실패합니다. 따라서 실제 요청이 들어와 최초로 사용될 때에만 생성하는 지연 초기화 방식을
// 사용합니다.
let cachedClient: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // 실제 값이 없는 채로 클라이언트를 만들면 "TypeError: fetch failed"처럼
    // 원인을 알기 어려운 네트워크 오류로 이어지므로, 여기서 바로 명확한 에러를 던집니다.
    throw new Error(
      "Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다. " +
        "Vercel 프로젝트의 Settings > Environment Variables에서 값을 등록한 뒤 다시 배포해주세요."
    );
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}

/**
 * 실제 Supabase 클라이언트는 최초 사용 시점에 생성됩니다.
 * 기존 호출부(`supabaseAdmin.from(...)` 등)는 그대로 사용할 수 있습니다.
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseAdmin() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export const SUBMISSIONS_BUCKET = "submissions";
