#!/usr/bin/env python3
"""Static server with HTTP Range support (python's http.server has none; Safari/WebKit need ranges for <video>)."""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
class H(SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get('Range'); path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path): return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng); size = os.path.getsize(path)
        a = int(m.group(1)) if m.group(1) else 0; b = int(m.group(2)) if m.group(2) else size - 1; b = min(b, size - 1)
        f = open(path, 'rb'); f.seek(a); self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path)); self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {a}-{b}/{size}'); self.send_header('Content-Length', str(b - a + 1)); self.end_headers()
        self._left = b - a + 1; return f
    def copyfile(self, src, dst):
        left = getattr(self, '_left', None)
        try:
            while True:
                n = 65536 if left is None else min(65536, left)
                if n <= 0: break
                d = src.read(n)
                if not d: break
                dst.write(d); left = None if left is None else left - len(d)
        except (BrokenPipeError, ConnectionResetError): pass
        self._left = None
    def end_headers(self): self.send_header('Accept-Ranges', 'bytes'); super().end_headers()
    def log_message(self, *a): pass
ThreadingHTTPServer(('', int(sys.argv[1]) if len(sys.argv) > 1 else 8099), H).serve_forever()
