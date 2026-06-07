#!/usr/bin/env python3
import argparse
import asyncio
import json
import random
import sys

import websockets

DEFAULT_HOST = "192.168.1.17"
DEFAULT_PORT = 8765


def build_config_message(node_id, latitude, longitude, camera_count):
    data = {
        "type": "config",
        "data": {
            "coordinates": [{
                "latitude": latitude,
                "longitude": longitude
            }],
            "camera_count": camera_count,
            "governorate": "TAMZARA",
            "address": "Fake Intersection",
            "capacity": 20,
        }
    }
    if node_id is not None:
        data["data"]["node_id"] = int(node_id)
    return data


def build_vehicle_data_message(node_id, camera_count):
    cameras = []
    for camera_index in range(1, camera_count + 1):
        camera_id = f"cam_{camera_index}"
        lane_count = random.randint(1, 3)
        lane_counts = [
            {"lane": lane, "count": random.randint(1, 30)}
            for lane in range(1, lane_count + 1)
        ]
        avg_speeds = [
            {"lane": lane, "speed_kmh": round(random.uniform(10, 45), 1)}
            for lane in range(1, lane_count + 1)
        ]
        cameras.append({
            "camera_id": camera_id,
            "lane_counts": lane_counts,
            "avg_speeds": avg_speeds,
        })

    return {
        "type": "vehicle_data",
        "data": {
            "node_id": int(node_id),
            "vehicle_data": cameras
        }
    }


def build_notif_message(node_id):
    return {
        "type": "notif",
        "node_id": int(node_id)
    }


async def run_simulator(host, port, node_id, latitude, longitude, camera_count, interval, send_notif):
    uri = f"ws://{host}:{port}"
    print(f"Connecting to node ingest websocket: {uri}")

    try:
        async with websockets.connect(uri) as ws:
            # Register node if requested
            config_payload = build_config_message(node_id, latitude, longitude, camera_count)
            print(f"Sending config payload: {json.dumps(config_payload)}")
            await ws.send(json.dumps(config_payload))

            if node_id is None:
                response = await ws.recv()
                print(f"Received config response: {response}")
                try:
                    parsed = json.loads(response)
                    node_id = parsed.get("data", {}).get("node_id") or parsed.get("node_id")
                    if node_id is None:
                        raise ValueError("Received no node_id from config response")
                except Exception as exc:
                    print(f"Error parsing config response: {exc}")
                    return
                print(f"Using assigned node_id={node_id}")
            else:
                print(f"Using provided node_id={node_id}")

            print(f"Starting periodic vehicle data for node_id={node_id}")
            while True:
                payload = build_vehicle_data_message(node_id, camera_count)
                print(f"Sending vehicle data: {json.dumps(payload)}")
                await ws.send(json.dumps(payload))

                if send_notif and random.random() < 0.2:
                    notif_payload = build_notif_message(node_id)
                    print(f"Sending notification: {json.dumps(notif_payload)}")
                    await ws.send(json.dumps(notif_payload))

                await asyncio.sleep(interval)
    except OSError as e:
        print(f"Connection failed: {e}")
        print("Verify the websocket server is running and use the same host as app_v3.py")
    except Exception as e:
        print(f"WebSocket error: {e}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Fake traffic node simulator for TrafficCAM dashboard."
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="WebSocket server host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="WebSocket server port")
    parser.add_argument("--node-id", help="Existing node ID to use (if omitted, config registers a new node)")
    parser.add_argument("--latitude", type=float, default=36.806389, help="Node latitude")
    parser.add_argument("--longitude", type=float, default=10.177222, help="Node longitude")
    parser.add_argument("--camera-count", type=int, default=1, help="Number of cameras for the fake node")
    parser.add_argument("--interval", type=float, default=5.0, help="Seconds between messages")
    parser.add_argument("--notif", action="store_true", help="Send occasional notification messages")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        asyncio.run(
            run_simulator(
                args.host,
                args.port,
                args.node_id,
                args.latitude,
                args.longitude,
                args.camera_count,
                args.interval,
                args.notif,
            )
        )
    except KeyboardInterrupt:
        print("Fake node simulator stopped by user")
        sys.exit(0)


if __name__ == "__main__":
    main()
