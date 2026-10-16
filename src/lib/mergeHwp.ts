/**
 * HWP(한글) 병합은 Node.js에서 직접 처리할 수 없습니다. HWP5는 한컴의 독점
 * 바이너리(OLE2 Compound File) 포맷이라 공개된 JS/Node 라이브러리가 없기
 * 때문에, 같은 Vercel 프로젝트에 함께 배포되는 Python 서버리스 함수
 * (api/hwp_merge.py — CFB 라이터/HWP5 병합 로직까지 전부 이 한 파일에 있습니다.
 * Vercel의 Python 빌더가 로컬 서브패키지를 안정적으로 함께 묶어주지 않는
 * 문제가 있어 의도적으로 한 파일로 합쳤습니다)를 내부적으로 호출해 처리합니다.
 *
 * 동작 방식: 첫 번째 파일의 컨테이너(스타일/폰트 등 DocInfo)를 그대로 두고,
 * 이후 파일들의 BodyText 섹션만 이어 붙인 뒤 섹션 개수를 패치합니다. 모든
 * 제출 파일이 같은 예시 양식에서 비롯된 경우(이 앱의 일반적인 사용 흐름)에
 * 안전하게 동작할 가능성이 높지만, 실제 한글 프로그램으로 결과물을
 * 검증하지는 못한 best-effort 구현입니다. 운영에 사용하기 전 반드시 실제
 * 한글에서 열어 확인하세요 — 문제가 있으면 /api/zip(전체 파일 ZIP)으로
 * 대체하세요.
 *
 * 파일 내용은 base64로 직접 주고받지 않습니다. Vercel Serverless Function은
 * 요청/응답 바디가 약 4.5MB로 제한되어 있어(FUNCTION_PAYLOAD_TOO_LARGE /
 * HTTP 413), 제출 파일이 여러 개이거나 하나라도 크면 금방 한도를 넘습니다.
 * 대신 각 원본 파일의 R2 서명(presigned) GET URL만 넘겨 Python 함수가 직접
 * R2에서 내려받게 하고, 병합 결과도 Python이 (route.ts가 미리 발급한) 서명된
 * PUT URL로 R2에 직접 업로드합니다 — Python 쪽에 AWS SDK(boto3) 설치 없이
 * 표준 라이브러리(urllib)만으로 처리되며, 양쪽 모두 Vercel 함수 바디 한도를
 * 거치지 않습니다. 업로드가 끝나면 route.ts가 그 결과 객체를 직접 내려받아
 * 응답을 만들고, 임시 객체는 정리합니다.
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
  const endpoint = `${origin}/api/hwp_merge`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    // JSON이 아닌 응답(예: Python 함수가 아예 크래시해 Vercel의 기본
    // 404/500 HTML 페이지가 내려온 경우)인 경우 원인을 알 수 있도록 상태
    // 코드와 응답 앞부분을 그대로 노출합니다.
    throw new Error(
      `HWP 병합 함수가 올바르지 않은 응답을 반환했습니다 (HTTP ${res.status}). ` +
        `api/hwp_merge.py가 Vercel에 Python 함수로 배포됐는지, 함수 로그에 ` +
        `크래시가 있는지 확인하세요. 응답 일부: ${rawText.slice(0, 200)}`
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
