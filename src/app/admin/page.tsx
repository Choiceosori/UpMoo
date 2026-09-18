"use client";

import { useEffect, useState } from "react";
import { School } from "@/lib/types";

const SESSION_KEY = "upmoo.adminPassword";

export default function AdminPage() {
  const [password, setPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newlyCreatedCode, setNewlyCreatedCode] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) setPassword(saved);
  }, []);

  useEffect(() => {
    if (password) fetchSchools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const fetchSchools = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schools");
      const json = await res.json();
      setSchools(json.schools ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    // 실제 인증 여부는 학교 등록 요청 시 서버에서 최종 검증됩니다.
    const res = await fetch("/api/schools", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": passwordInput },
      body: JSON.stringify({ name: "" }),
    });
    if (res.status === 401) {
      setAuthError("관리자 비밀번호가 올바르지 않습니다.");
      return;
    }
    sessionStorage.setItem(SESSION_KEY, passwordInput);
    setPassword(passwordInput);
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    setError(null);
    setNewlyCreatedCode(null);
    const res = await fetch("/api/schools", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": password },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "학교 등록에 실패했습니다.");
      return;
    }
    setName("");
    setNewlyCreatedCode(json.school.code);
    fetchSchools();
  };

  const handleDelete = async (id: string) => {
    if (!password) return;
    if (!confirm("이 학교와 관련된 모든 데이터가 삭제됩니다. 계속할까요?")) return;
    await fetch(`/api/schools/${id}`, {
      method: "DELETE",
      headers: { "x-admin-password": password },
    });
    fetchSchools();
  };

  if (!password) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <form onSubmit={handleLogin} className="card w-full max-w-sm space-y-4">
          <h1 className="text-lg font-bold text-slate-900">전체 관리자 로그인</h1>
          <div>
            <label className="label">관리자 비밀번호</label>
            <input
              type="password"
              className="input"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
          </div>
          {authError && <p className="text-sm text-red-500">{authError}</p>}
          <button type="submit" className="btn-primary w-full">
            로그인
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">전체 관리자</h1>
          <p className="mt-1 text-sm text-slate-500">
            학교를 등록하면 학교 전용 접속 코드가 발급됩니다. 이 코드를 해당 학교 담당자/제출자에게
            전달하면, 학교별로 완전히 분리된 데이터베이스 공간에서 업무를 관리할 수 있습니다.
          </p>
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-800">신규 학교 등록</h2>
          <form onSubmit={handleCreateSchool} className="flex gap-2">
            <input
              className="input"
              placeholder="학교 이름 (예: 서울초등학교)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn-primary whitespace-nowrap">
              등록
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          {newlyCreatedCode && (
            <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
              발급된 접속 코드: <span className="font-mono font-bold">{newlyCreatedCode}</span>
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-800">등록된 학교 ({schools.length})</h2>
          {loading ? (
            <p className="text-sm text-slate-400">불러오는 중...</p>
          ) : schools.length === 0 ? (
            <p className="text-sm text-slate-400">등록된 학교가 없습니다.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2">학교명</th>
                  <th className="py-2">접속 코드</th>
                  <th className="py-2">등록일</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {schools.map((school) => (
                  <tr key={school.id} className="border-b border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{school.name}</td>
                    <td className="py-2 font-mono text-brand-700">{school.code}</td>
                    <td className="py-2 text-slate-400">
                      {new Date(school.created_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDelete(school.id)}
                        className="text-xs font-medium text-red-500 hover:underline"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
