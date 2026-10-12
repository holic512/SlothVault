"""Real isolated Nginx transfer checks. Requires Docker; never uses deployment data."""
import http.client
import json
import os
import signal
import subprocess
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slothvault_deploy.nginx_config import patch_server
from slothvault_deploy.nginx_discovery import Instance, docker_instances, output
from slothvault_deploy.nginx import SystemNginxManager
from slothvault_deploy.nginx_management import apply_updates

MIB = 1024 * 1024


class Upstream(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_PATCH(self):
        self.do_POST()

    def do_POST(self):
        assert self.headers.get('X-Sloth-Test') == 'inherited', 'proxy headers lost'
        size = int(self.headers.get('Content-Length', '0'))
        remaining = size
        while remaining:
            data = self.rfile.read(min(remaining, MIB))
            if not data:
                raise RuntimeError('incomplete request')
            remaining -= len(data)
        body = str(size).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET(True)

    def do_GET(self, head=False):
        assert self.headers.get('X-Sloth-Test') == 'inherited', 'proxy headers lost'
        size, etag = 8 * MIB, '"transfer-fixture"'
        start, end, status = 0, size - 1, 200
        if self.headers.get('Range') == 'bytes=10-99' and self.headers.get('If-Range', etag) == etag:
            start, end, status = 10, 99, 206
        self.send_response(status)
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('ETag', etag)
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        if not head:
            remaining = end - start + 1
            while remaining:
                data = b'x' * min(remaining, 64 * 1024)
                self.wfile.write(data)
                remaining -= len(data)


def docker(*args):
    return subprocess.check_output(('docker', *args), text=True, timeout=60).strip()


def main():
    native = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == '--nginx' else None
    if not native:
        docker('version', '--format', '{{.Server.Version}}')
    upstream = ThreadingHTTPServer(('0.0.0.0', 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    name = 'slothvault-nginx-test-' + uuid4().hex[:12]
    try:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            if native:
                with socket.socket() as listener:
                    listener.bind(('127.0.0.1', 0))
                    port = listener.getsockname()[1]
                listen = '127.0.0.1:' + str(port)
                upstream_host = '127.0.0.1'
            else:
                listen, upstream_host = '80', 'host.docker.internal'
            source = "map $http_upgrade $connection_upgrade { default upgrade; '' close; }\n" + 'server { listen ' + listen + '; server_name vault.test; location / { proxy_set_header Connection ""; proxy_set_header X-Sloth-Test inherited; proxy_pass http://' + upstream_host + ':' + str(upstream.server_port) + '; } }\n'
            other = 'server { listen ' + listen + '; server_name other.test; location / { return 200 "other-site"; } }\n'
            (root / 'vault.conf').write_text(source + other)
            if native:
                (root / 'nginx.conf').write_text('pid ' + str(root / 'nginx.pid') + '; error_log ' + str(root / 'error.log') + '; events {} http { access_log off; client_body_temp_path ' + str(root / 'body') + '; proxy_temp_path ' + str(root / 'proxy') + '; include ' + str(root / 'vault.conf') + '; }')
                manager = SystemNginxManager(native, root / 'nginx.conf', None)
                manager.arguments = ('-p', str(root), '-c', str(root / 'nginx.conf'))
                output(manager.command())
                native_pid = int((root / 'nginx.pid').read_text())
                description = output(manager.command('-V'))
                instance = Instance(manager, True, str(root / 'nginx.conf'), str(root), (description.stdout + description.stderr).splitlines()[0])
                instance.load()
            else:
                docker('run', '-d', '--name', name, '--add-host', 'host.docker.internal:host-gateway',
                       '-p', '127.0.0.1::80', '-v', str(root) + ':/etc/nginx/conf.d:ro', 'nginx:stable-alpine')
                port = int(docker('port', name, '80/tcp').split(':')[-1])
                instance = docker_instances(name)[0]
            def request(method, path, size=0, headers=None, oversized=False):
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
                connection.putrequest(method, path, skip_host=True)
                connection.putheader('Host', 'vault.test')
                if size:
                    connection.putheader('Content-Length', str(size))
                for key, value in (headers or {}).items():
                    connection.putheader(key, value)
                connection.endheaders()
                if not oversized:
                    remaining = size
                    while remaining:
                        data = b'x' * min(remaining, MIB)
                        connection.send(data)
                        remaining -= len(data)
                response = connection.getresponse()
                body, status, response_headers = response.read(), response.status, dict(response.getheaders())
                connection.close()
                return status, response_headers, body
            for attempt in range(30):
                try:
                    request('HEAD', '/')
                    break
                except OSError:
                    time.sleep(.1)
            baseline = request('PATCH', '/api/admin/mm/backup/imports/test', 8 * MIB, oversized=True)
            assert baseline[0] == 413, (baseline[0], baseline[2][:200])
            assert instance.config is not None, instance.error
            origin, site, inherited = next(item for item in instance.config.servers() if item[0].endswith('/vault.conf'))
            new, _ = patch_server(instance.config, origin, site, inherited)
            apply_updates(root, instance, {origin: new})
            time.sleep(.3)
            for path, size in (('/api/admin/mm/backup/imports/test', 8 * MIB), ('/api/admin/mm/file', 25 * MIB), ('/api/account/commissions/1/files', 100 * MIB)):
                status, _, body = request('PATCH' if '/backup/' in path else 'POST', path, size)
                assert status == 200 and body == str(size).encode(), (path, status, body[:100])
            assert request('POST', '/api/admin/mm/file', 25 * MIB + 1, oversized=True)[0] == 413
            assert request('POST', '/api/account/commissions/1/files', 100 * MIB + 1, oversized=True)[0] == 413
            download = '/api/admin/mm/backup/snapshots/test/download'
            status, headers, body = request('GET', download, headers={'Range': 'bytes=10-99', 'If-Range': '"transfer-fixture"'})
            assert status == 206 and body == b'x' * 90 and headers['Content-Range'] == f'bytes 10-99/{8 * MIB}'
            status, headers, body = request('HEAD', download)
            assert status == 200 and body == b'' and headers['Accept-Ranges'] == 'bytes'
            assert request('GET', download)[2] == b'x' * (8 * MIB)
            assert (root / 'vault.conf').read_text().endswith(other)
            print(json.dumps({'nginx': instance.version, 'passed': ['empty WebSocket map key', 'empty proxy header value', '8 MiB backup chunk', '25 MiB multipart', '100 MiB commission file', 'finite boundaries', 'Range/If-Range/HEAD', 'download bytes', 'other site preserved']}))
    finally:
        if native and 'native_pid' in locals():
            try:
                os.kill(native_pid, signal.SIGQUIT)
            except ProcessLookupError:
                pass
        elif not native:
            subprocess.run(('docker', 'rm', '-f', name), capture_output=True, check=False)
        upstream.shutdown()
        upstream.server_close()


if __name__ == '__main__':
    main()
