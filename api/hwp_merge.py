"""
Vercel Python Serverless Function.
여러 HWP(한글) 파일을 하나로 병합합니다. Next.js API Route
(src/app/api/merge/route.ts)가 category="hwp"일 때 내부적으로 이 엔드포인트를
호출합니다.

요청: POST { "urls": ["<서명된 GET URL>", ...] }  (제출 순서대로)
응답: 200 { "url": "<병합된 .hwp 파일의 서명된 다운로드 URL>" }
      4xx/5xx { "error": "메시지" }

파일 내용을 요청/응답 바디에 직접 base64로 싣지 않는 이유: Vercel Serverless
Function의 요청/응답 바디는 약 4.5MB로 제한되어 있어(FUNCTION_PAYLOAD_TOO_LARGE
/ HTTP 413), 제출 파일이 여러 개이거나 하나라도 크면 쉽게 그 한도를 넘습니다.
대신 Node(src/lib/mergeHwp.ts)가 각 원본 파일의 R2 서명 URL만 넘겨주면, 이
함수가 직접 R2에서 내려받아 병합하고, 결과도 R2에 업로드한 뒤 서명 URL만
돌려줍니다. 자세한 구현은 api/_hwplib/storage.py, api/_hwplib/merge.py 참고.

구현 방식과 한계는 api/_hwplib/merge.py 상단 주석을 참고하세요.
이 기능은 실제 한글(HWP) 프로그램으로 검증하지 못한 best-effort 구현입니다.
"""
import json
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler

from _hwplib.merge import HwpMergeError, merge_hwp_files
from _hwplib.storage import StorageError, upload_and_sign


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=25) as resp:
        return resp.read()


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

        urls = payload.get("urls")
        if not isinstance(urls, list) or not urls:
            self._send_json(400, {"error": "urls 배열이 필요합니다."})
            return

        try:
            buffers = [_download(u) for u in urls]
        except Exception as exc:  # noqa: BLE001
            self._send_json(502, {"error": f"원본 파일을 내려받지 못했습니다: {exc}"})
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

        try:
            signed_url = upload_and_sign(merged, "application/x-hwp", "merged.hwp")
        except StorageError as exc:
            self._send_json(500, {"error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send_json(500, {"error": f"병합 결과 업로드 중 알 수 없는 오류: {exc}"})
            return

        self._send_json(200, {"url": signed_url})
