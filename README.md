# UpMoo — 학교 업무 자료 수합 시스템

Next.js(App Router) + TypeScript + Tailwind CSS 기반의 학교 업무 자료 수합/병합 웹 서비스입니다.
프론트엔드와 백엔드(Serverless API Routes)가 하나의 Next.js 프로젝트로 통합되어 있어 Vercel에 그대로 배포할 수 있습니다.

## 기술 스택

- **Next.js 14 (App Router)** — 프론트엔드 + API Routes(서버리스 함수)
- **TypeScript, React, Tailwind CSS**
- **Supabase** — Postgres(메타데이터) + Storage(제출 파일 저장), 학교별 데이터 완전 분리
- **exceljs** — 서버(API Route)에서의 엑셀 병합
- **xlsx (SheetJS)** — 브라우저에서의 엑셀 파싱/유효성 검사
- **@hello-pangea/dnd** — 수합 업무 순서 Drag & Drop

## 폴더 구조

```
src/
  app/
    layout.tsx, page.tsx, globals.css     # 랜딩(역할·학교 코드 선택) 페이지
    admin/page.tsx                        # 전체 관리자: 학교 등록/목록/삭제
    manager/
      page.tsx                            # 담당자 홈
      classes/page.tsx                    # 학년별 학급 수 등록
      tasks/page.tsx                      # 수합 업무 등록 + 순서 변경(DnD)
      tasks/[taskId]/page.tsx             # 업무 상세: 제출 현황 + 통합 파일 수합
    submit/page.tsx                       # 제출자: 학년/반/업무 선택, 업로드, 검증, 보관/수정
    api/
      schools/route.ts, schools/[id]/route.ts
      classes/route.ts
      tasks/route.ts, tasks/[taskId]/route.ts, tasks/reorder/route.ts
      submissions/route.ts, submissions/[id]/route.ts
      merge/route.ts                      # 엑셀(일반/지출) 병합 후 파일 다운로드 응답
  components/
    Navbar.tsx, SchoolGate.tsx, FileDropzone.tsx, WarningModal.tsx
  context/SchoolContext.tsx               # 선택된 학교 정보(로컬 스토리지 유지)
  lib/
    types.ts, filename.ts, supabaseAdmin.ts, clientFileScan.ts
    validators/pii.ts                     # 이름/주민등록번호 패턴 검출
    validators/expenseExcel.ts            # 지출 엑셀 [내용,규격,단위,수량,예상단가] 검증
    excel/mergeGeneral.ts                 # 시트별 분리/추가 병합
    excel/mergeExpense.ts                 # 기존 데이터 하단에 Append 병합
supabase/schema.sql                       # Supabase Postgres 테이블 생성 스크립트
```

## 권한 모델

- **전체 관리자**: `ADMIN_PASSWORD` 환경변수로 보호되는 `/admin` 페이지에서 학교를 등록하면
  학교 전용 **접속 코드**가 발급됩니다.
- **업무 담당자 / 제출자**: 랜딩 페이지에서 학교 접속 코드를 입력해 입장합니다. 이후 모든 데이터
  (`schools.id` 기준)는 학교별로 완전히 분리되어 조회/저장됩니다 — 이것이 "학교별 Database 관리
  권한"에 해당합니다. 코드를 아는 사람만 해당 학교의 작업 공간에 접근할 수 있습니다.
- 별도 회원가입 없이 학교 코드 + 학년/반 선택으로 "제출자 본인"을 식별하는 경량 모델입니다. 더 엄격한
  개별 로그인이 필요하다면 Supabase Auth를 추가로 연동할 수 있습니다.

## 로컬 개발

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

### Supabase 준비

1. Supabase 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase/schema.sql` 내용을 실행합니다.
3. **Storage** 메뉴에서 `submissions` 버킷을 생성합니다(Public 여부는 무관 — 서버가 Service Role
   Key로만 접근하며, 다운로드는 signed URL을 사용합니다).
4. `.env.local`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`를 입력합니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에 Import 합니다 (Framework Preset: Next.js — 자동 감지).
2. Vercel 프로젝트의 **Environment Variables**에 `.env.example`의 항목을 동일하게 등록합니다.
3. Deploy — App Router 페이지와 API Routes(서버리스 함수)가 함께 배포됩니다.

## 핵심 기능 흐름

### 제출자 페이지 (`app/submit/page.tsx`)
1. 학년 → 반 선택 (업무의 수합 단위가 "학년별"이면 반 선택은 비활성화)
2. 업무명 선택 → 해당 업무에서 허용한 파일 종류 중 선택
3. 드래그 앤 드롭 업로드 시:
   - 엑셀 파일은 브라우저에서 SheetJS로 파싱해 전체 셀 텍스트에서 이름/주민등록번호 패턴을 검사합니다.
     PDF/HWP 등 바이너리 포맷은 완전한 텍스트 파싱이 어려워 best-effort로만 스캔합니다(README 한계 참고).
   - "엑셀(지출)" 선택 시 `[내용, 규격, 단위, 수량, 예상단가]` 양식을 검사해 필수 칸 누락 여부를 확인합니다.
   - 위 검사에서 문제가 발견되면 지정된 문구의 경고 팝업이 표시됩니다(제출을 막지는 않고 확인만 요구).
4. 제출 시 서버가 `[학년(_반)_업무명_원본파일명]` 규칙으로 파일명을 자동 생성해 저장합니다.
5. "내 제출 자료" 목록에서 재업로드/삭제가 가능합니다.

### 담당자 업무 상세 (`app/manager/tasks/[taskId]/page.tsx`)
- "엑셀(일반) 통합 다운로드": `app/api/merge/route.ts`가 exceljs로 각 제출 파일의 시트를 그대로
  유지한 채 하나의 워크북에 순서대로 추가합니다(시트명 앞에 제출자 라벨 부여).
- "엑셀(지출) 통합 다운로드": 동일 양식의 데이터 행을 새 워크북의 기존 데이터 하단에 이어붙입니다(Append).

## 문제 해결 (Troubleshooting)

- **`TypeError: fetch failed`**: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`가 Vercel에 설정되지
  않았을 때 발생합니다. Vercel Settings > Environment Variables에 값을 등록한 뒤 반드시
  **재배포**하세요(환경변수는 재배포해야 반영됩니다).
- **`Could not find the table 'public.xxx' in the schema cache`**: Supabase 프로젝트에
  `supabase/schema.sql`이 아직 실행되지 않았습니다. SQL Editor에서 전체 내용을 실행하세요.
- **`new row violates row-level security policy for table "xxx"`**: 보통 `anon`(공개) 키를
  `service_role`(비밀) 키 자리에 잘못 넣었을 때 발생합니다. Supabase Project Settings > API에서
  `service_role secret` 키를 다시 복사해 Vercel의 `SUPABASE_SERVICE_ROLE_KEY`에 넣고 재배포하세요.
  - `/admin` 페이지 로그인 후 "Supabase 연결 확인" 버튼을 누르면 실제 키 값을 노출하지 않고
    service_role 키가 맞는지 진단해줍니다.
  - 일부 테이블에서만 이 오류가 난다면 `supabase/schema.sql`을 다시 한번 전체 실행해보세요. 최신
    버전은 service_role에 대해 명시적으로 모든 작업을 허용하는 정책을 각 테이블에 추가해,
    BYPASSRLS 속성에만 의존하지 않도록 되어 있습니다(재실행해도 안전하게 idempotent합니다).

## 보안 참고사항

`npm audit` 기준으로 아래 항목이 남아있으며, 실사용 전 인지해두는 것을 권장합니다.

- **xlsx (SheetJS)**: npm 레지스트리에 배포된 버전에는 패치되지 않은 Prototype Pollution / ReDoS
  이슈가 있습니다(SheetJS는 패치 버전을 자체 CDN에서만 배포). 제출자가 업로드한 파일만 파싱하는
  내부용 도구라는 점에서 위험도는 제한적이지만, 운영 환경에서는 `https://cdn.sheetjs.com`에서
  제공하는 최신 패치 버전으로 교체하는 것을 권장합니다.
- **exceljs → uuid(전이 의존성)**: exceljs가 내부적으로 사용하는 uuid 패키지에 알려진 이슈가
  있으나, 외부 입력과 무관한 내부 ID 생성용으로만 사용되어 영향은 제한적입니다.
- **next 번들 postcss**: Next.js가 빌드 도구 내부에 번들한 postcss 버전 관련 경고이며, 프로젝트가
  직접 사용하는 postcss(빌드 시점에만 사용)와는 별개입니다. Next.js 메이저 업그레이드 시 함께
  해소됩니다.

## 알려진 한계 (스캐폴드 범위)

- PDF/HWP 파일의 개인정보 검출은 브라우저에서 완전한 파싱이 불가능해 best-effort 수준입니다.
  운영 환경에서는 서버 측에서 `pdf-parse`, HWP 파서 등을 붙여 정밀도를 높이는 것을 권장합니다.
- Vercel 서버리스 함수의 기본 요청 본문 크기 제한(약 4.5MB)으로 인해 대용량 파일은 실패할 수 있습니다.
  대용량 파일 지원이 필요하면 Supabase Storage에 클라이언트에서 직접 업로드(Signed Upload URL)하는
  방식으로 전환하세요.
- 제출자 식별은 별도 로그인 없이 학교 코드 + 학년/반 조합을 사용하는 경량 모델입니다.
