"""
Windows + 실제 설치된 한글(HWP) 프로그램을 이용해 여러 HWP 파일을 진짜로
병합하는 전용 서비스입니다.

왜 필요한가: Vercel은 Linux 서버리스 환경이라 한글 프로그램 자체를 설치하거나
실행할 수 없습니다(COM 자동화는 Windows 전용 기술). api/hwp_merge.py처럼
OLE2/HWP5 바이너리 포맷을 처음부터 직접 구현해서 흉내 내려는 시도는 구조적
정합성은 맞출 수 있어도, 한컴의 비공개 내부 검증 로직까지는 따라가기 어렵다는
게 실제 한글로 테스트하며 확인됐습니다. 그래서 이 서비스는 "흉내"가 아니라
사용자가 예전부터 쓰던 Tkinter 수합 프로그램과 동일하게, comtypes로 진짜
HWPFrame.HwpObject를 띄워 InsertFile/SaveAs를 시킵니다 — 실제 한글이 파일을
저장하므로 포맷이 항상 올바릅니다.

실행 전제 조건:
  - Windows PC (또는 Windows 서버/VM), 인터넷에 항상 연결되어 있어야 함
  - 한글 프로그램이 정식 설치/라이선스 되어 있어야 함
  - pip install comtypes

실행:
  set MERGE_SECRET=원하는-비밀값   (REM: 외부에 노출되는 서비스이므로 꼭 설정하세요)
  set PORT=8765                    (선택, 기본값 8765)
  python server.py

외부(Vercel)에서 이 PC로 접근하려면 집 공유기 포트포워딩 대신 Cloudflare
Tunnel이나 ngrok 같은 도구로 HTTPS 공개 URL을 만드는 걸 권장합니다(포트포워딩/
고정 IP 없이 바로 가능, 설정도 더 간단합니다). 공개 URL이 준비되면 Vercel
프로젝트 환경변수에 등록하세요:
  HWP_MERGE_SERVICE_URL=https://<터널 URL>/merge
  HWP_MERGE_SERVICE_SECRET=<MERGE_SECRET과 동일한 값>

요청/응답 형식은 api/hwp_merge.py(Vercel Python 함수, 실패 시 폴백용으로 남겨둠)와
동일하게 맞춰서, Next.js 쪽(src/lib/mergeHwp.ts)이 이 둘 중 어느 쪽을 호출하든
같은 코드로 처리할 수 있게 했습니다.

요청: POST /merge
  헤더: X-Merge-Secret: <MERGE_SECRET 환경변수와 동일한 값> (MERGE_SECRET 설정 시 필수)
  바디: { "urls": ["<입력 파일의 서명 GET URL>", ...], "uploadUrl": "<병합 결과를 올릴 서명 PUT URL>" }
응답: 200 { "ok": true } / 4xx-5xx { "error": "메시지" }

한 번에 하나의 병합 요청만 처리합니다(HWP COM 자동화는 동시 실행에 약하고,
한글 프로그램 인스턴스가 꼬일 수 있어 안전하게 직렬화합니다). 동시에 다른
요청이 들어오면 503을 돌려주며, Next.js 쪽에서 재시도하지 않으므로 여러
업무를 한꺼번에 병합하려면 순서대로 눌러주세요.
"""
import json
import os
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import comtypes
import comtypes.client as client

MERGE_SECRET = os.environ.get("MERGE_SECRET", "")
PORT = int(os.environ.get("PORT", "8765"))

# HWP COM 자동화는 동시성에 약하므로, 한 번에 하나의 병합 작업만 처리합니다.
_lock = threading.Lock()


def _download(url: str, dest_path: str) -> None:
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = resp.read()
    with open(dest_path, "wb") as f:
        f.write(data)


def _upload(url: str, path: str) -> None:
    with open(path, "rb") as f:
        data = f.read()
    request = urllib.request.Request(url, data=data, method="PUT")
    with urllib.request.urlopen(request, timeout=60) as resp:
        if resp.status not in (200, 201, 204):
            raise RuntimeError(f"업로드 응답이 비정상입니다 (HTTP {resp.status}).")


def merge_with_real_hwp(file_paths, output_path):
    """실제 한글 프로그램을 COM으로 띄워 file_paths를 순서대로 이어붙여
    output_path에 저장합니다. 로직은 사용자의 기존 Tkinter 수합 프로그램
    (HWPCombinerApp.combine_files)과 동일하며, GUI/대화상자만 제거했습니다."""
    comtypes.CoInitialize()
    hwp = None
    try:
        hwp = client.CreateObject("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        hwp.XHwpWindows.Item(0).Visible = False  # 한글 창 숨김

        first_file = file_paths[0]
        format_type = "HWPX" if first_file.lower().endswith(".hwpx") else "HWP"
        hwp.Open(first_file, format_type, "HWPC")
        time.sleep(1)  # 파일을 열 시간을 부여 (원본 스크립트와 동일)

        for file_path in file_paths[1:]:
            hwp.HAction.Run("MoveDocEnd")
            hwp.HAction.GetDefault("InsertFile", hwp.HParameterSet.HInsertFile.HSet)
            hwp.HParameterSet.HInsertFile.filename = file_path
            hwp.HParameterSet.HInsertFile.KeepSection = 1  # 다음 쪽에 이어 붙이기
            hwp.HAction.Execute("InsertFile", hwp.HParameterSet.HInsertFile.HSet)

            hwp.HAction.Run("MoveDocEnd")
            hwp.HAction.Run("InsertPage")
            time.sleep(0.5)  # 파일을 붙일 시간을 부여

        out_format = "HWPX" if output_path.lower().endswith(".hwpx") else "HWP"
        hwp.SaveAs(output_path, out_format, "HWPC")

        if not os.path.exists(output_path):
            raise RuntimeError("한글이 결과 파일을 생성하지 않았습니다.")
    finally:
        if hwp is not None:
            try:
                hwp.Quit()
            except Exception:
                pass
        comtypes.CoUninitialize()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/merge":
            self._send_json(404, {"error": "알 수 없는 경로입니다."})
            return

        if MERGE_SECRET and self.headers.get("X-Merge-Secret") != MERGE_SECRET:
            self._send_json(401, {"error": "인증에 실패했습니다."})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw_body)
        except Exception:
            self._send_json(400, {"error": "요청 본문을 파싱하지 못했습니다."})
            return

        urls = payload.get("urls")
        upload_url = payload.get("uploadUrl")
        if not isinstance(urls, list) or not urls:
            self._send_json(400, {"error": "urls 배열이 필요합니다."})
            return
        if not isinstance(upload_url, str) or not upload_url:
            self._send_json(400, {"error": "uploadUrl이 필요합니다."})
            return

        if not _lock.acquire(blocking=False):
            self._send_json(
                503, {"error": "다른 병합 작업이 진행 중입니다. 잠시 후 다시 시도하세요."}
            )
            return

        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                local_paths = []
                try:
                    for i, url in enumerate(urls):
                        p = os.path.join(tmp_dir, f"input_{i}.hwp")
                        _download(url, p)
                        local_paths.append(p)
                except Exception as exc:  # noqa: BLE001
                    self._send_json(502, {"error": f"원본 파일을 내려받지 못했습니다: {exc}"})
                    return

                output_path = os.path.join(tmp_dir, "merged.hwp")
                try:
                    merge_with_real_hwp(local_paths, output_path)
                except Exception as exc:  # noqa: BLE001
                    self._send_json(500, {"error": f"한글 자동화 중 오류가 발생했습니다: {exc}"})
                    return

                try:
                    _upload(upload_url, output_path)
                except Exception as exc:  # noqa: BLE001
                    self._send_json(502, {"error": f"병합 결과 업로드에 실패했습니다: {exc}"})
                    return

            self._send_json(200, {"ok": True})
        finally:
            _lock.release()

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    if not MERGE_SECRET:
        print(
            "경고: MERGE_SECRET 환경변수가 설정되지 않았습니다. "
            "인증 없이 누구나 이 서비스를 호출할 수 있습니다 — 외부에 노출하기 전에 꼭 설정하세요."
        )
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"HWP 병합 서비스 시작: http://0.0.0.0:{PORT}/merge (Ctrl+C로 종료)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
