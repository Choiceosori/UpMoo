/**
 * 개인정보(이름/주민등록번호) 패턴 검출 유틸리티.
 * 완벽한 개인정보 탐지는 불가능하므로, 사람이 최종 확인할 수 있도록
 * "의심되는" 경우에 경고 팝업을 띄우기 위한 휴리스틱입니다.
 */

// 주민등록번호 패턴: 생년월일 6자리 + 성별구분 1~4로 시작하는 뒷자리 6자리 (하이픈 유무 모두 허용)
const RRN_PATTERN =
  /\b\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[-\s]?[1-4]\d{6}\b/;

// 한국 성씨 상위 목록 (흔한 성씨 기반 이름 패턴 검출용)
const KOREAN_SURNAMES = [
  "김","이","박","최","정","강","조","윤","장","임",
  "한","오","서","신","권","황","안","송","전","홍",
  "유","고","문","양","손","배","백","허","남","심",
  "노","하","곽","성","차","주","우","구","민","류",
];

const SURNAME_SET = new Set(KOREAN_SURNAMES);

// "성씨 + 1~3음절 한글" 형태의 토큰을 이름 후보로 간주
const NAME_TOKEN_PATTERN = /[가-힣]{2,4}/g;

export function containsResidentNumber(text: string): boolean {
  return RRN_PATTERN.test(text);
}

export function containsKoreanNameCandidate(text: string): boolean {
  const matches = text.match(NAME_TOKEN_PATTERN);
  if (!matches) return false;
  return matches.some((token) => SURNAME_SET.has(token[0]) && token.length <= 4);
}

export interface PiiScanResult {
  flagged: boolean;
  hasResidentNumber: boolean;
  hasNameCandidate: boolean;
}

export function scanTextForPii(text: string): PiiScanResult {
  const hasResidentNumber = containsResidentNumber(text);
  const hasNameCandidate = containsKoreanNameCandidate(text);
  return {
    flagged: hasResidentNumber || hasNameCandidate,
    hasResidentNumber,
    hasNameCandidate,
  };
}

export const PII_WARNING_MESSAGE =
  "⚠️ 개인정보가 포함될 수 있으므로 사람 이름, 주민등록번호가 검출될 경우 개인정보를 확인해주세요!";
