import asyncio
import json
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from host_settings import load_or_create_config, save_config


BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "brunner_config.json"
HOST_SCRIPT = BASE_DIR / "brunner_host.py"
LOG_FILE = BASE_DIR / "brunner_host.log"
MANAGER_PORT = 8998


HOST_PROCESS = None


HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BRunner Native Host</title>
  <style>
    :root { color-scheme: dark; font-family: Segoe UI, Arial, sans-serif; background: #0b1020; color: #e5edf8; }
    body { margin: 0; padding: 24px; }
    main { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 24px; }
    section { border: 1px solid #26344f; border-radius: 8px; background: #111a2d; padding: 16px; }
    label { display: grid; gap: 6px; margin: 0 0 12px; color: #aebbd0; font-size: 13px; }
    input, textarea { box-sizing: border-box; width: 100%; border: 1px solid #33445e; border-radius: 6px; background: #0b1322; color: #e5edf8; padding: 9px; font: 13px Consolas, monospace; }
    textarea { min-height: 120px; resize: vertical; }
    button { border: 1px solid #3b5275; border-radius: 6px; background: #1d4ed8; color: white; padding: 9px 12px; cursor: pointer; font-weight: 700; }
    button.secondary { background: #17233a; }
    button.danger { background: #7f1d1d; border-color: #991b1b; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .status { border-radius: 999px; padding: 6px 10px; background: #17233a; color: #bfdbfe; font-size: 12px; font-weight: 800; }
    pre { max-height: 260px; overflow: auto; white-space: pre-wrap; border: 1px solid #26344f; border-radius: 6px; background: #08101f; padding: 12px; color: #aebbd0; }
    small { color: #8091a8; }
    @media (max-width: 720px) { body { padding: 12px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>BRunner Native Host</h1>
      <small>Backend settings, status, and allowlisted data/file roots</small>
    </div>
    <span id="status" class="status">Loading</span>
  </header>

  <section>
    <div class="row">
      <button onclick="startHost()">Start Host</button>
      <button class="danger" onclick="stopHost()">Stop Host</button>
      <button class="secondary" onclick="refreshAll()">Refresh</button>
    </div>
  </section>

  <section>
    <h2>Settings</h2>
    <div class="grid">
      <label>Pairing key <input id="pairing_key"></label>
      <label>Paired extension id <input id="paired_extension_id"></label>
      <label>Host port <input id="port" type="number" min="1" max="65535"></label>
      <label>Local file/data access <input id="local_file_enabled" type="checkbox"></label>
    </div>
    <label>Allowed roots, one per line
      <textarea id="allowed_roots"></textarea>
      <small>Relative roots resolve under BRunner_Host. These roots apply to local uploads and dataset sources.</small>
    </label>
    <button onclick="saveSettings()">Save Settings</button>
  </section>

  <section>
    <h2>Capabilities</h2>
    <p><code>os.keystroke</code>, <code>local_file.read</code>, <code>data_source.read</code>, <code>execution_log.save</code></p>
  </section>

  <section>
    <h2>Logs</h2>
    <pre id="logs">Loading logs...</pre>
  </section>
</main>
<script>
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? {"Content-Type": "application/json"} : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}
async function refreshAll() {
  const [config, status, logs] = await Promise.all([api("/api/config"), api("/api/status"), api("/api/logs")]);
  document.getElementById("pairing_key").value = config.pairing_key || "";
  document.getElementById("paired_extension_id").value = config.paired_extension_id || "";
  document.getElementById("port").value = config.port || 8999;
  document.getElementById("local_file_enabled").checked = config.local_file_access?.enabled === true;
  document.getElementById("allowed_roots").value = (config.local_file_access?.allowed_roots || []).join("\\n");
  document.getElementById("status").textContent = status.running ? `Host running on ${config.port}` : "Host stopped";
  document.getElementById("logs").textContent = logs.content || "No logs yet.";
}
async function saveSettings() {
  await api("/api/config", {
    pairing_key: document.getElementById("pairing_key").value,
    paired_extension_id: document.getElementById("paired_extension_id").value || null,
    port: document.getElementById("port").value,
    local_file_access: {
      enabled: document.getElementById("local_file_enabled").checked,
      allowed_roots: document.getElementById("allowed_roots").value.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean)
    }
  });
  await refreshAll();
  alert("Settings saved. Restart host to apply changes.");
}
async function startHost() { await saveSettings(); await api("/api/start", {}); await refreshAll(); }
async function stopHost() { await api("/api/stop", {}); await refreshAll(); }
refreshAll().catch(error => alert(error.message));
</script>
</body>
</html>"""


class HostUiHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_html(HTML)
        elif self.path == "/api/config":
            self.send_json(load_or_create_config(CONFIG_FILE, BASE_DIR))
        elif self.path == "/api/status":
            self.send_json({"ok": True, "running": host_running()})
        elif self.path == "/api/logs":
            content = ""
            if LOG_FILE.exists():
                content = LOG_FILE.read_text(encoding="utf-8", errors="replace")[-20000:]
            self.send_json({"ok": True, "content": content})
        else:
            self.send_json({"ok": False, "error": "Not found"}, status=404)

    def do_POST(self):
        body = self.read_json()
        if self.path == "/api/config":
            self.send_json(save_config(CONFIG_FILE, body))
        elif self.path == "/api/start":
            start_host()
            self.send_json({"ok": True, "running": host_running()})
        elif self.path == "/api/stop":
            stop_host()
            self.send_json({"ok": True, "running": host_running()})
        else:
            self.send_json({"ok": False, "error": "Not found"}, status=404)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_html(self, content):
        encoded = content.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_json(self, payload, status=200):
        body = dict(payload)
        body.setdefault("ok", status < 400)
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_args):
        return


def host_command():
    if getattr(sys, "frozen", False):
        return [sys.executable, "--serve-host"]
    return [sys.executable, str(HOST_SCRIPT)]


def start_host():
    global HOST_PROCESS
    if HOST_PROCESS and HOST_PROCESS.poll() is None:
        return
    HOST_PROCESS = subprocess.Popen(
        host_command(),
        cwd=str(BASE_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def stop_host():
    global HOST_PROCESS
    if HOST_PROCESS and HOST_PROCESS.poll() is None:
        HOST_PROCESS.terminate()


def host_running():
    return bool(HOST_PROCESS and HOST_PROCESS.poll() is None)


def run_manager():
    server = ThreadingHTTPServer(("127.0.0.1", MANAGER_PORT), HostUiHandler)
    url = f"http://127.0.0.1:{MANAGER_PORT}/"
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    print(f"BRunner Host UI: {url}")
    try:
        server.serve_forever()
    finally:
        stop_host()
        server.server_close()


def run_embedded_host():
    from brunner_host import main

    asyncio.run(main())


if __name__ == "__main__":
    if "--serve-host" in sys.argv:
        run_embedded_host()
    else:
        run_manager()
