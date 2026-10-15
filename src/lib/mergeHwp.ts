/**
 * HWP(한글) 병합은 Node.js에서 직접 처리할 수 없습니다. HWP5는 한컴의 독점
 * 바이너리(OLE2 Compound File) 포맷이라 공개된 JS/Node 라이브러리가 없기
 * 때문에, 같은 Vercel 프로젝트에 함께 배포되는 Python 서버리스 함수
 * (api/hwp_merge.py, api/_hwplib/*)를 내부적으로 호출해 처리합니다.
 *
 * 동작 방식: 첫 번째 파일의 컨테이너(스타일/폰트 등 DocInfo)를 그대로 두고,
 * 이후 파일들의 BodyText 섹션만 이어 붙인 뒤 섹션 개수를 패치합니다. 모든
 * 제출 파일이 같은 예시 양식에서 비롯된 경우(이 앱의 일반적인 사용 흐름)에
 * 안전하게 동작할 가능성이 높지만, 실제 한글 프로그램으로 결과물을
 * 검증하지는 못한 best-effort 구현입니다. 운영에 사용하기 전 반드시 실제
 * 한글에서 열어 확인하세요 — 문제가 있으면 /api/zip(전체 파일 ZIP)으로
 * 대체하세요.
 */
export interface HwpMergeInput {
  label: string;
  buffer: Buffer;
}

export async function mergeHwpFiles(inputs: HwpMergeInput[], origin: string): Promise<Buffer> {
  const res = await fetch(`${origin}/api/hwp_merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: inputs.map((input) => input.buffer.toString("base64")),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error ?? "HWP 병합 함수 호출에 실패했습니다.");
  }
  if (!json.data) {
    throw new Error("HWP 병합 함수가 올바른 응답을 반환하지 않았습니다.");
  }

  return Buffer.from(json.data, "base64");
}
