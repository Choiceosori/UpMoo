"""
Vercel Python Serverless Function.
여러 HWP(한글) 파일을 하나로 병합합니다. Next.js API Route
(src/app/api/merge/route.ts)가 category="hwp"일 때 내부적으로 이 엔드포인트를
호출합니다.

요청: POST { "files": ["<base64>", "<base64>", ...] }  (제출 순서대로)
응답: 200 { "data": "<base64 merged .hwp>" }
      4xx/5xx { "error": "메시지" }

구현 방식과 한계는 api/_hwplib/merge.py 상단 주석을 참고하세요.
이 기능은 실제 한글(HWP) 프로그램으로 검증하지 못한 best-effort 구현입니다.
"""
import base64
import json
import traceback
from http.server import BaseHTTPRequestHandler

from _hwplib.merge import HwpMergeError, merge_hwp_files


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw_body)
        except Exception:
            self._send_json(400, {"error": "요청 본문을 파싱하지 못했습니다."})
            return

        files_b64 = payload.get("files")
        if not isinstance(files_b64, list) or not files_b64:
            self._send_json(400, {"error": "files 배열이 필요합니다."})
            return

        try:
            buffers = [base64.b64decode(f) for f in files_b64]
        except Exception:
            self._send_json(400, {"error": "files의 base64 디코딩에 실패했습니다."})
            return

        try:
            merged = merge_hwp_files(buffers)
        except HwpMergeError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send_json(500, {"error": f"HWP 병합 중 알 수 없는 오류: {exc}"})
            return

        self._send_json(200, {"data": base64.b64encode(merged).decode("ascii")})
