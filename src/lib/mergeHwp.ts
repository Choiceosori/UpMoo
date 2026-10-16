import { queryOne } from "@/lib/db";

/**
 * HWP(한글) 병합은 Node.js에서 직접 처리할 수 없습니다. HWP5는 한컴의 독점
 * 바이너리(OLE2 Compound File) 포맷이라 공개된 JS/Node 라이브러리가 없기
 * 때문에, 외부 병합 워커에 맡깁니다.
 *
 * **기본 동작(폴링 큐)**: `hwp_merge_jobs` 테이블에 작업을 등록해두면,
 * 사용자의 Windows+한글 PC에서 돌아가는 워커(windows-hwp-service/worker.py)가
 * 몇 초 간격으로 "할 일 있나요?"라고 Vercel에 물어보며(일반적인 웹 브라우징과
 * 동일한 나가는 HTTPS 요청) 작업을 가져가 실제 한글 프로그램(comtypes COM
 * 자동화)으로 병합한 뒤 결과를 보고합니다. 왜 이런 폴링 구조인가: 처음엔
 * Vercel이 Windows PC를 직접 호출하는 방식(HTTP 서버 + Cloudflare Tunnel/ngrok)
 * 으로 만들었는데, 학교/회사 네트워크가 터널링 도구를 막는 경우가 흔해서(SSL
 * 검사 프록시가 터널 핸드셰이크를 가로채 HTML 에러 페이지를 돌려주는 식으로
 * 나타남) 실제로 동작하지 않는 환경이 많았습니다. 폴링 방식은 PC가 외부
 * 연결을 받을 필요가 전혀 없어 어떤 네트워크에서도 안정적으로 동작합니다.
 * PC가 꺼져 있거나 워커가 안 떠 있으면, 일정 시간 기다린 뒤 "평일 업무시간에
 * 다시 시도해달라"는 안내를 보여줍니다.
 *
 * **폴백(실험적, 기본 비활성)**: `HWP_MERGE_USE_EXPERIMENTAL_PYTHON=true`로
 * 명시적으로 켠 경우에만, 같은 Vercel 프로젝트의 Python 함수(api/hwp_merge.py)
 * 를 호출합니다. HWP5 포맷을 처음부터 직접 구현해 흉내 내는 기능인데, 구조적
 * 정합성은 문제없어도 실제 한글 프로그램의 비공개 내부 검증을 통과하지 못해
 * 파일을 아예 인식하지 못하는 사례가 실제 테스트로 확인됐습니다. 기본값은
 * 꺼짐(비활성)이고, 켜더라도 결과물을 반드시 실제 한글에서 열어 확인하세요.
 *
 * 어느 쪽이든 파일 내용은 base64로 직접 주고받지 않습니다. Vercel Serverless
 * Function은 요청/응답 바디가 약 4.5MB로 제한되어 있어(FUNCTION_PAYLOAD_TOO_LARGE
 * / HTTP 413), 대신 각 원본 파일의 R2 서명(presigned) GET URL만 넘겨 병합
 * 백엔드가 직접 R2에서 내려받게 하고, 병합 결과도 그쪽이 (route.ts가 미리
 * 발급한) 서명된 PUT URL로 R2에 직접 업로드합니다. 업로드가 끝나면 route.ts가
 * 그 결과 객체를 직접 내려받아 응답을 만들고, 임시 객체는 정리합니다.
 */
export interface HwpMergeInput {
  label: string;
  url: string;
}

const SERVICE_UNAVAILABLE_MESSAGE =
  "HWP 통합 서비스에 연결할 수 없습니다. 담당자 PC가 꺼져 있을 수 있습니다 — 평일 9시~16시에 다시 시도해주세요.";

export async function mergeHwpFiles(
  inputs: HwpMergeInput[],
  resultUploadUrl: string,
  origin: string
): Promise<void> {
  const urls = inputs.map((input) => input.url);

  if (process.env.HWP_MERGE_USE_EXPERIMENTAL_PYTHON === "true") {
    await mergeViaVercelPythonFallback(urls, resultUploadUrl, origin);
    return;
  }

  await mergeViaWorkerQueue(urls, resultUploadUrl);
}

/**
 * 폴링 큐 모드 — hwp_merge_jobs에 작업을 등록하고, Windows 워커가 그걸 가져가
 * 처리할 때까지 DB를 주기적으로 조회하며 기다립니다. 이 함수는 이미 Next.js
 * 서버(route.ts) 안에서 실행되므로 DB에 바로 접근합니다 — 별도 HTTP 왕복이
 * 필요 없습니다.
 */
async function mergeViaWorkerQueue(urls: string[], resultUploadUrl: string): Promise<void> {
  const job = await queryOne<{ id: string }>(
    `insert into hwp_merge_jobs (urls, upload_url) values ($1, $2) returning id`,
    [JSON.stringify(urls), resultUploadUrl]
  );
  if (!job) {
    throw new Error("HWP 병합 작업을 등록하지 못했습니다.");
  }

  // Vercel 함수의 maxDuration(60초) 안에서 여유를 두고 최대 50초까지 대기합니다.
  const deadline = Date.now() + 50_000;
  const pollIntervalMs = 2_000;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const row = await queryOne<{ status: string; error: string | null }>(
      `select status, error from hwp_merge_jobs where id = $1`,
      [job.id]
    );
    if (!row) {
      throw new Error("HWP 병합 작업 상태를 확인하지 못했습니다.");
    }
    if (row.status === "done") {
      return;
    }
    if (row.status === "error") {
      throw new Error(row.error ?? "HWP 병합 중 오류가 발생했습니다.");
    }
    // pending/processing이면 계속 대기
  }

  throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 폴백 — Vercel Python 함수(api/hwp_merge.py)를 직접 호출. 기본적으로
 * 비활성(HWP_MERGE_USE_EXPERIMENTAL_PYTHON=true로 명시해야 쓰입니다), 실험적.
 */
async function mergeViaVercelPythonFallback(
  urls: string[],
  resultUploadUrl: string,
  origin: string
): Promise<void> {
  const endpoint = `${origin}/api/hwp_merge`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, uploadUrl: resultUploadUrl }),
    });
  } catch (err) {
    throw new Error(
      `HWP 병합 함수(${endpoint})에 연결하지 못했습니다: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const rawText = await res.text();
  let json: unknown = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(
      `HWP 병합 함수가 올바르지 않은 응답을 반환했습니다 (HTTP ${res.status}). ` +
        `api/hwp_merge.py가 Vercel에 Python 함수로 배포됐는지, 함수 로그에 크래시가 있는지 확인하세요. ` +
        `응답 일부: ${rawText.slice(0, 200)}`
    );
  }

  const ok = typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true;
  if (!res.ok || !ok) {
    const rawError = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
    // Vercel이 함수 크래시/타임아웃 시 자체적으로 { error: { code, message } }
    // 같은 객체 형태 에러를 돌려줄 수 있어, 문자열이 아니면 그대로 new Error에
    // 넘기지 않고 JSON으로 펼쳐서 보여줍니다 ("[object Object]"로 뭉개지는 것을 방지).
    const errorText =
      typeof rawError === "string"
        ? rawError
        : rawError !== undefined
          ? JSON.stringify(rawError)
          : `HWP 병합 함수 호출에 실패했습니다 (HTTP ${res.status}).`;
    throw new Error(errorText);
  }
}
