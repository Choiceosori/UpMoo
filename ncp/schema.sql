-- UpMoo: 학교 업무 자료 수합 시스템 DB 스키마 (네이버 클라우드 Cloud DB for PostgreSQL용)
-- NCP 콘솔에서 발급받은 접속 정보로 psql 또는 DBeaver 등으로 접속한 뒤 실행하세요.
--
-- 이 스키마는 Supabase용 schema.sql과 달리 RLS(행 단위 보안) 정책이 없습니다.
-- 이 앱은 PostgREST 같은 공개 API 계층 없이, 서버(API Route)가 DATABASE_URL로
-- 직접 접속해서만 데이터베이스를 사용하므로 RLS 자체가 필요하지 않습니다.

create extension if not exists "pgcrypto";

-- 1. 학교
create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique, -- 담당자/제출자가 로그인 시 입력하는 학교 코드
  created_at timestamptz not null default now()
);

-- 2. 학년별 학급 수 (연도/학기 단위)
create table if not exists class_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  year integer not null,
  semester integer not null check (semester in (1, 2)),
  grade integer not null check (grade between 1 and 6),
  class_count integer not null check (class_count >= 0),
  created_at timestamptz not null default now(),
  unique (school_id, year, semester, grade)
);

-- 3. 수합 업무
create table if not exists collection_tasks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  description text,
  deadline timestamptz,
  unit text not null check (unit in ('grade', 'class')),
  allowed_file_types text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_collection_tasks_school on collection_tasks(school_id, position);

-- 4. 제출 자료
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  task_id uuid not null references collection_tasks(id) on delete cascade,
  grade integer not null,
  class_no integer,
  file_category text not null check (file_category in ('hwp', 'pdf', 'excel_general', 'excel_expense')),
  original_filename text not null,
  stored_filename text not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  pii_flagged boolean not null default false,
  expense_flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_submissions_task on submissions(task_id);
create index if not exists idx_submissions_school on submissions(school_id);

-- Object Storage 버킷은 NCP 콘솔의 Object Storage 화면에서 별도로 생성하세요
-- (예: "upmoo-submissions"). 버킷 이름은 NCP_STORAGE_BUCKET 환경변수로 지정합니다.
