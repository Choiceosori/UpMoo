-- UpMoo: 학교 업무 자료 수합 시스템 DB 스키마 (Supabase / PostgreSQL)
-- Supabase 대시보드 SQL Editor에서 실행하세요.

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

-- Storage 버킷은 Supabase Storage 화면에서 "submissions" 이름으로 생성하세요.
-- 서버(API Route)는 Service Role Key로만 접근하므로 RLS는 기본(비공개) 상태로 두어도 안전합니다.
alter table schools enable row level security;
alter table class_structures enable row level security;
alter table collection_tasks enable row level security;
alter table submissions enable row level security;

-- service_role은 원래 RLS를 우회하지만, 일부 프로젝트 설정(예: 테이블에
-- FORCE ROW LEVEL SECURITY가 걸려있거나 role 속성이 달라진 경우)에서는
-- 우회가 보장되지 않을 수 있습니다. 이를 위해 service_role에 대해
-- 명시적으로 모든 작업을 허용하는 정책을 추가해 안전하게 만듭니다.
-- (anon/authenticated 키는 아래 정책 대상이 아니므로 여전히 차단됩니다.)
drop policy if exists "service_role_all_schools" on schools;
create policy "service_role_all_schools" on schools
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all_class_structures" on class_structures;
create policy "service_role_all_class_structures" on class_structures
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all_collection_tasks" on collection_tasks;
create policy "service_role_all_collection_tasks" on collection_tasks
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all_submissions" on submissions;
create policy "service_role_all_submissions" on submissions
  for all to service_role using (true) with check (true);
