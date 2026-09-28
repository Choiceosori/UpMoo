import { SubmissionUnit } from "./types";

/** 파일명에 사용할 수 없는 문자를 언더스코어로 치환합니다. */
function sanitize(part: string): string {
  return part.replace(/[\\/:*?"<>|]/g, "_").trim();
}

function splitExt(filename: string): { base: string; ext: string } {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, idx), ext: filename.slice(idx) };
}

/** 파일 확장자만 추출합니다 (점 포함, 예: ".hwp"). 확장자가 없으면 빈 문자열을 반환합니다. */
export function extractExtension(filename: string): string {
  return splitExt(filename).ext;
}

/**
 * 제출 파일명을 [학년_반_업무명_파일명] 규칙으로 변환합니다.
 * 학년 단위 제출(unit === "grade")인 경우 반 구분 없이 "N학년" 표기만 포함합니다.
 */
export function buildSubmissionFilename(params: {
  unit: SubmissionUnit;
  grade: number;
  classNo: number | null;
  taskName: string;
  originalFilename: string;
}): string {
  const { unit, grade, classNo, taskName, originalFilename } = params;
  const { base, ext } = splitExt(originalFilename);
  const gradePart = `${grade}학년`;
  const classPart = unit === "class" && classNo ? `_${classNo}반` : "";
  const taskPart = sanitize(taskName);
  const namePart = sanitize(base);
  return `${gradePart}${classPart}_${taskPart}_${namePart}${ext}`;
}
