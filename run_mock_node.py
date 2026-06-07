import argparse
import asyncio
import json
import os
import random
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("Warning: python-dotenv not installed. Skipping .env file loading.")
    print("Install with: pip install python-dotenv")

ROOT = os.path.dirname(os.path.abspath(__file__))

HTTP_BACKEND = os.path.join(ROOT, "backend", "http", "serverAppV2.py")
WS_BACKEND   = os.path.join(ROOT, "backend", "websocket", "app_v3.py")
MAP_JS       = os.path.join(ROOT, "frontend", "js", "my_scripts", "map_v3.js")


def replace_frontend_host(host):
    try:
        with open(MAP_JS, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"Unable to find frontend file: {MAP_JS}")
        return False

    new_content = []
    replaced = False
    for line in content.splitlines():
        if line.strip().startswith("let ipAdress ="):
            new_content.append(f'let ipAdress = "{host}";')
            replaced = True
        else:
            new_content.append(line)

    if not replaced:
        print("Could not patch frontend host in map_v3.js")
        return False

    with open(MAP_JS, "w", encoding="utf-8") as f:
        f.write("\n".join(new_content) + "\n")
    print(f"Patched frontend host in {MAP_JS} to {host}")
    return True


def wait_for_port(host, port, timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def start_process(script_path, env):
    python = sys.executable
    return subprocess.Popen([python, script_path], env=env, cwd=ROOT)


async def run_mock_node(host, port, latitude, longitude, camera_count, interval, node_id=None, send_notif=False):
    uri = f"ws://{host}:{port}"
    print(f"Connecting mock node to {uri}")

    async with websockets.connect(uri) as ws:
        config_payload = build_config_payload(node_id, latitude, longitude, camera_count)
        await ws.send(json.dumps(config_payload))
        print(f"Sent config payload: {json.dumps(config_payload)}")

        if node_id is None:
            response = await ws.recv()
            print(f"Received config response: {response}")
            parsed = json.loads(response)
            node_id = parsed.get("data", {}).get("node_id") or parsed.get("node_id")
            if node_id is None:
                raise RuntimeError("Config response did not return a node_id")
            print(f"Assigned node_id={node_id}  <-- use this with --node-id next time")

        while True:
            payload = build_vehicle_payload(node_id, camera_count)
            await ws.send(json.dumps(payload))
            print(f"Sent vehicle payload: {json.dumps(payload)}")
            if send_notif and random.random() < 0.25:
                notif = {"type": "notif", "node_id": str(node_id)}
                await ws.send(json.dumps(notif))
                print(f"Sent notification payload: {json.dumps(notif)}")
            await asyncio.sleep(interval)


def build_config_payload(node_id, latitude, longitude, camera_count):
    data = {
        "type": "config",
        "data": {
            "coordinates": [{"latitude": latitude, "longitude": longitude}],
            "camera_count": camera_count,
            "governorate": "TAMZARA",
            "address": "Fake Intersection",
            "capacity": 20,
        }
    }
    if node_id is not None:
        data["data"]["node_id"] = str(node_id)
    return data


def build_vehicle_payload(node_id, camera_count):
    cameras = []
    for camera_index in range(1, camera_count + 1):
        lane_count = random.randint(1, 3)
        lane_counts = [{"lane": lane, "count": random.randint(1, 30)} for lane in range(1, lane_count + 1)]
        avg_speeds  = [{"lane": lane, "speed_kmh": round(random.uniform(10, 45), 1)} for lane in range(1, lane_count + 1)]
        cameras.append({
            "camera_id": f"cam_{camera_index}",
            "lane_counts": lane_counts,
            "avg_speeds": avg_speeds,
        })
    return {"type": "vehicle_data", "data": {"node_id": str(node_id), "vehicle_data": cameras}}


async def main():
    parser = argparse.ArgumentParser(description="Run the full frontend + backend demo with a mock node.")
    parser.add_argument("--host",         default=os.getenv("WEBSOCKET_HOST", "192.168.1.17"), help="Host for frontend/backend/ws connection")
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_DB_URL") or None,        help="Optional Supabase DATABASE_URL")
    parser.add_argument("--latitude",     type=float, default=36.806389,  help="Mock node latitude")
    parser.add_argument("--longitude",    type=float, default=10.177222,  help="Mock node longitude")
    parser.add_argument("--camera-count", type=int,   default=1,          help="Number of cameras")
    parser.add_argument("--interval",     type=float, default=5.0,        help="Seconds between mock data messages")
    parser.add_argument("--node-id",      default=None,                   help="Existing node ID to reuse (skips creating a new node)")
    parser.add_argument("--no-browser",   action="store_true",            help="Do not open the dashboard automatically")
    parser.add_argument("--send-notif",   action="store_true",            help="Send occasional fake notifications")
    args = parser.parse_args()

    if not replace_frontend_host(args.host):
        return

    env = os.environ.copy()
    if args.supabase_url:
        env["SUPABASE_DB_URL"] = args.supabase_url
    env["WEBSOCKET_HOST"] = args.host
    env.setdefault("PGHOST",     os.getenv("PGHOST",     "localhost"))
    env.setdefault("PGPORT",     os.getenv("PGPORT",     "5432"))
    env.setdefault("PGUSER",     os.getenv("PGUSER",     "postgres"))
    env.setdefault("PGPASSWORD", os.getenv("PGPASSWORD", "admin"))
    env.setdefault("PGDATABASE", os.getenv("PGDATABASE", "trafficam_db"))

    print("Starting HTTP backend...")
    http_proc = start_process(HTTP_BACKEND, env)
    print(f"HTTP PID={http_proc.pid}")

    print("Starting WebSocket backend...")
    ws_proc = start_process(WS_BACKEND, env)
    print(f"WebSocket PID={ws_proc.pid}")

    if not wait_for_port(args.host, 5000, timeout=30):
        print("HTTP backend did not become ready on port 5000")
        terminate_processes([http_proc, ws_proc])
        return

    if not wait_for_port(args.host, 8765, timeout=30):
        print("WebSocket backend did not become ready on port 8765")
        terminate_processes([http_proc, ws_proc])
        return

    if not args.no_browser:
        url = f"http://{args.host}:5000/"
        print(f"Opening dashboard in browser: {url}")
        webbrowser.open(url)

    try:
        await run_mock_node(
            args.host, 8765,
            args.latitude, args.longitude,
            args.camera_count, args.interval,
            node_id=args.node_id,
            send_notif=args.send_notif
        )
    except KeyboardInterrupt:
        print("Interrupted, shutting down")
    finally:
        terminate_processes([http_proc, ws_proc])


def terminate_processes(procs):
    for proc in procs:
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    import websockets
    asyncio.run(main())