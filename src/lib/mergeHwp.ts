/**
 * HWP(한글) 병합은 Node.js에서 직접 처리할 수 없습니다. HWP5는 한컴의 독점
 * 바이너리(OLE2 Compound File) 포맷이라 공개된 JS/Node 라이브러리가 없기
 * 때문에, 외부 병합 백엔드를 HTTP로 호출해 처리합니다. 두 가지 백엔드를
 * 지원하며, 둘 다 동일한 요청/응답 스펙을 씁니다:
 *   POST { urls: [서명 GET URL, ...], uploadUrl: 서명 PUT URL } -> { ok: true } | { error }
 *
 * 1. (권장) `HWP_MERGE_SERVICE_URL` 환경변수가 설정되어 있으면 그 주소를
 *    호출합니다 — windows-hwp-service/server.py, 즉 한글 프로그램이 실제로
 *    설치된 사용자의 Windows PC에서 돌아가는 서비스입니다. comtypes로 진짜
 *    HWPFrame.HwpObject를 띄워 InsertFile/SaveAs를 시키므로 한글이 직접
 *    저장한 파일과 동일하게 항상 정상적으로 열립니다.
 * 2. (폴백, 비권장) 설정이 없으면 같은 Vercel 프로젝트의 Python 함수
 *    (api/hwp_merge.py)를 호출합니다. 이건 HWP5(OLE2 Compound File) 포맷을
 *    처음부터 직접 구현해 흉내 내는 실험적 기능인데, 구조적으로는 문제가
 *    없어도 실제 한글 프로그램의 비공개 내부 검증을 통과하지 못할 수 있다는
 *    게 실제 테스트로 확인됐습니다. 1번 서비스를 설정하는 걸 강력히
 *    권장하고, 그마저 안 되면 /api/zip(전체 파일 ZIP)으로 대체하세요.
 *
 * 파일 내용은 base64로 직접 주고받지 않습니다. Vercel Serverless Function은
 * 요청/응답 바디가 약 4.5MB로 제한되어 있어(FUNCTION_PAYLOAD_TOO_LARGE /
 * HTTP 413), 제출 파일이 여러 개이거나 하나라도 크면 금방 한도를 넘습니다.
 * 대신 각 원본 파일의 R2 서명(presigned) GET URL만 넘겨 병합 백엔드가 직접
 * R2에서 내려받게 하고, 병합 결과도 그쪽이 (route.ts가 미리 발급한) 서명된
 * PUT URL로 R2에 직접 업로드합니다. 업로드가 끝나면 route.ts가 그 결과
 * 객체를 직접 내려받아 응답을 만들고, 임시 객체는 정리합니다.
 */
export interface HwpMergeInput {
  label: string;
  url: string;
}

export async function mergeHwpFiles(
  inputs: HwpMergeInput[],
  resultUploadUrl: string,
  origin: string
): Promise<void> {
  const serviceUrl = process.env.HWP_MERGE_SERVICE_URL;
  const endpoint = serviceUrl || `${origin}/api/hwp_merge`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (serviceUrl && process.env.HWP_MERGE_SERVICE_SECRET) {
    headers["X-Merge-Secret"] = process.env.HWP_MERGE_SERVICE_SECRET;
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        urls: inputs.map((input) => input.url),
        uploadUrl: resultUploadUrl,
      }),
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
    // JSON이 아닌 응답(예: 병합 백엔드가 아예 크래시했거나, Windows 서비스가
    // 꺼져 있어 터널/프록시가 자체 에러 페이지를 돌려준 경우)인 경우 원인을
    // 알 수 있도록 상태 코드와 응답 앞부분을 그대로 노출합니다.
    throw new Error(
      `HWP 병합 함수가 올바르지 않은 응답을 반환했습니다 (HTTP ${res.status}). ` +
        (serviceUrl
          ? `HWP_MERGE_SERVICE_URL(${serviceUrl})의 Windows 병합 서비스가 켜져 있는지 확인하세요. `
          : `api/hwp_merge.py가 Vercel에 Python 함수로 배포됐는지, 함수 로그에 크래시가 있는지 확인하세요. `) +
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
