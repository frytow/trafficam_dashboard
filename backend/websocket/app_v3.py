import os
import asyncio
import websockets
import json
import asyncpg
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Store connected WebSocket clients
connected_clients = set()

# Store additional data for each client
clients_data = {}

# Fetch lat/lon and intersection_id from the configured PostgreSQL database using node_id
async def fetch_location_from_db(node_id, pool):
    if pool is None:
        hash_val = hash(str(node_id)) % 1000
        latitude = 36.8 + (hash_val % 100) / 10000
        longitude = 10.2 + (hash_val % 100) / 10000
        logger.debug(f"DEMO MODE: Generated location for node_id={node_id}: latitude={latitude}, longitude={longitude}")
        return latitude, longitude, 1
    async with pool.acquire() as conn:
        result = await conn.fetchrow(
            """
            SELECT intersections.latitude, intersections.longitude, nodes.intersection_id
            FROM intersections
            JOIN nodes ON intersections.id = nodes.intersection_id
            WHERE nodes.id = $1
            """,
            int(node_id)
        )
        if result:
            latitude = result["latitude"]
            longitude = result["longitude"]
            intersection_id = result["intersection_id"]
            logger.debug(f"Fetched location for node_id={node_id}: latitude={latitude}, longitude={longitude}")
            return float(latitude), float(longitude), int(intersection_id)
        logger.debug(f"No location found for node_id={node_id}")
        return None, None, None

# Insert new intersection, node, and cameras into the database
async def insert_new_node(data, pool):
    if pool is None:
        latitude = float(data["data"]["coordinates"][0]["latitude"])
        longitude = float(data["data"]["coordinates"][0]["longitude"])
        camera_count = int(data["data"]["camera_count"])
        node_id = data["data"].get("node_id")

        if node_id is None:
            node_id = int(asyncio.get_event_loop().time() * 1000) % 100000

        logger.info(f"DEMO MODE: Node config received (no DB save): node_id={node_id}, lat={latitude}, lon={longitude}")
        return str(node_id), latitude, longitude, 1

    async with pool.acquire() as conn:
        async with conn.transaction():
            latitude = float(data["data"]["coordinates"][0]["latitude"])
            longitude = float(data["data"]["coordinates"][0]["longitude"])
            camera_count = int(data["data"]["camera_count"])
            governorate = data["data"].get("governorate", "Unknown")
            address = data["data"].get("address", "Unknown Address")
            capacity = int(data["data"].get("capacity", 20))
            node_id = data["data"].get("node_id")

            # Check for existing intersection
            intersection_result = await conn.fetchrow(
                """
                SELECT id FROM intersections
                WHERE latitude = $1 AND longitude = $2 AND address = $3
                """,
                latitude, longitude, address
            )

            if intersection_result:
                intersection_id = int(intersection_result["id"])
                logger.debug("Updated node")
                await conn.execute(
                    """
                    UPDATE intersections
                    SET governorate = $1, address = $2, latitude = $3, longitude = $4, capacity = $5
                    WHERE id = $6
                    """,
                    governorate, address, latitude, longitude, capacity, intersection_id
                )
                logger.debug(f"Updated intersection: intersection_id={intersection_id}")
            else:
                intersection_id = int(await conn.fetchval(
                    """
                    INSERT INTO intersections (governorate, address, latitude, longitude, capacity)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                    """,
                    governorate, address, latitude, longitude, capacity
                ))
                logger.debug(f"Inserted new intersection: intersection_id={intersection_id}")

            # Check for existing node
            node_result = None
            if node_id:
                node_result = await conn.fetchrow(
                    "SELECT id, intersection_id, cams FROM nodes WHERE id = $1",
                    int(node_id)
                )
            else:
                node_result = await conn.fetchrow(
                    "SELECT id, intersection_id, cams FROM nodes WHERE intersection_id = $1 AND cams = $2",
                    intersection_id, camera_count
                )

            if node_result:
                node_id = int(node_result["id"])
                existing_intersection_id = int(node_result["intersection_id"])
                existing_camera_count = node_result["cams"]
                if existing_camera_count != camera_count or existing_intersection_id != intersection_id:
                    await conn.execute(
                        "UPDATE nodes SET intersection_id = $1, cams = $2 WHERE id = $3",
                        intersection_id, camera_count, node_id
                    )
                    logger.debug(f"Updated node: node_id={node_id}, cams={camera_count}")
                else:
                    logger.debug(f"Node already exists: node_id={node_id}")
            else:
                node_id = int(await conn.fetchval(
                    "INSERT INTO nodes (intersection_id, cams) VALUES ($1, $2) RETURNING id",
                    intersection_id, camera_count
                ))
                logger.debug(f"Inserted new node: node_id={node_id}")

            await conn.execute("DELETE FROM cams WHERE node_id = $1", node_id)

            for i in range(1, camera_count + 1):
                camera_data = data["data"].get(f"camera_{i}", {})
                if camera_data:
                    stream_url = camera_data.get("video_source", "")
                    lane_number = int(camera_data.get("lane_number", 1))
                    logger.debug(f"Inserting camera {i} with stream_url: {stream_url}")
                    await conn.execute(
                        "INSERT INTO cams (node_id, lanes, ip_address) VALUES ($1, $2, $3)",
                        node_id, lane_number, stream_url
                    )

            logger.debug(f"Committed node configuration: node_id={node_id}, intersection_id={intersection_id}")
            return str(node_id), latitude, longitude, int(intersection_id)

# Save message to history table
async def save_to_history(data, intersection_id, pool):
    if pool is None:
        logger.debug(f"DEMO MODE: Skipping history save for intersection_id={intersection_id}")
        return
    async with pool.acquire() as conn:
        async with conn.transaction():
            vehicles_count = int(data.get("vehicles", 0))
            total_passed = 0
            for i in range(1, 5):
                key = f"voie_{i}"
                if key in data:
                    total_passed += int(data[key])
            speeds = [data.get(f"avg_speed_{i}", 0) for i in range(1, 5) if f"avg_speed_{i}" in data]
            if data.get("avg_speed") is not None:
                speeds.append(data["avg_speed"])
            # avg_speed column is INTEGER in DB — round to nearest int
            avg_speed = int(round(sum(speeds) / len(speeds))) if speeds else 0

            await conn.execute(
                "INSERT INTO history (intersection_id, vehicles_count, total_passed, avg_speed) VALUES ($1, $2, $3, $4)",
                int(intersection_id), vehicles_count, total_passed, avg_speed
            )

async def save_notification(node_id, intersection_id, pool):
    if pool is None:
        logger.debug(f"DEMO MODE: Skipping notification save for node_id={node_id}")
        return
    async with pool.acquire() as conn:
        async with conn.transaction():
            severity = 3
            content = "Traffic jam"
            await conn.execute(
                "INSERT INTO notifications (intersection_id, severety, content) VALUES ($1, $2, $3)",
                int(intersection_id), severity, content
            )
            logger.debug(f"Saved notification: intersection_id={intersection_id}, severity={severity}, content='{content}'")

async def handle_message(websocket, pool):
    global connected_clients, clients_data
    connected_clients.add(websocket)

    try:
        async for message in websocket:
            data = json.loads(message)
            logger.debug(f"Received message: {data}")
            message_type = data.get("type", "unknown")
            node_id = None

            if message_type == "vehicle_data":
                nested_data = data.get("data", {})
                node_id = nested_data.get("node_id", "Unknown")
                vehicle_data = nested_data.get("vehicle_data", [])

                vehicles_count = 0
                lane_data = {}
                lane_speeds = {}
                total_lanes = 0
                lane_mapping = {}
                current_lane = 1

                for camera_data in vehicle_data:
                    camera_id = camera_data.get("camera_id")
                    lane_counts = camera_data.get("lane_counts", [])
                    for lane in lane_counts:
                        lane_num = lane["lane"]
                        lane_mapping[(camera_id, lane_num)] = current_lane
                        current_lane += 1
                    total_lanes += len(lane_counts)

                for camera_data in vehicle_data:
                    camera_id = camera_data.get("camera_id")
                    lane_counts = camera_data.get("lane_counts", [])
                    avg_speeds = camera_data.get("avg_speeds", [])

                    vehicles_count += sum(lane["count"] for lane in lane_counts)

                    for lane in lane_counts:
                        lane_num = lane["lane"]
                        mapped_lane = lane_mapping.get((camera_id, lane_num), lane_num)
                        lane_key = f"voie_{mapped_lane}"
                        lane_data[lane_key] = lane_data.get(lane_key, 0) + lane["count"]

                    for speed in avg_speeds:
                        lane_num = speed["lane"]
                        speed_kmh = speed["speed_kmh"]
                        mapped_lane = lane_mapping.get((camera_id, lane_num), lane_num)
                        lane_speeds.setdefault(mapped_lane, []).append(speed_kmh)

                speed_data = {}
                unique_lanes = sorted(lane_data.keys(), key=lambda x: int(x.split('_')[1]))
                num_lanes = len(unique_lanes)

                if num_lanes == 1:
                    lane_num = int(unique_lanes[0].split('_')[1])
                    speeds = lane_speeds.get(lane_num, [])
                    avg_speed = sum(speeds) / len(speeds) if speeds else 0
                    speed_data["avg_speed"] = round(avg_speed, 2)
                else:
                    for lane_key in unique_lanes:
                        lane_num = int(lane_key.split('_')[1])
                        speeds = lane_speeds.get(lane_num, [])
                        avg_speed = sum(speeds) / len(speeds) if speeds else 0
                        speed_data[f"avg_speed_{lane_num}"] = round(avg_speed, 2)

                if node_id not in clients_data:
                    latitude, longitude, intersection_id = await fetch_location_from_db(node_id, pool)
                    if latitude is None or longitude is None or intersection_id is None:
                        await websocket.send(json.dumps({"error": "Node ID not found in database"}))
                        continue
                    clients_data[node_id] = {
                        "latitude": latitude,
                        "longitude": longitude,
                        "node_id": node_id,
                        "intersection_id": int(intersection_id)
                    }
                    logger.debug(f"New node connected: {node_id} at ({latitude}, {longitude})")
                else:
                    latitude, longitude, intersection_id = await fetch_location_from_db(node_id, pool)
                    if latitude is None or longitude is None or intersection_id is None:
                        await websocket.send(json.dumps({"error": "Node ID not found in database"}))
                        continue
                    clients_data[node_id].update({
                        "latitude": latitude,
                        "longitude": longitude,
                        "intersection_id": int(intersection_id)
                    })
                    logger.debug(f"Refreshed coordinates for node_id={node_id}: ({latitude}, {longitude})")

                response_data = {
                    "message_type": "data",
                    "node_id": node_id,
                    "latitude": float(latitude),
                    "longitude": float(longitude),
                    "vehicles": vehicles_count,
                    **lane_data,
                    **speed_data
                }

                await save_to_history(response_data, intersection_id, pool)

                logger.debug(f"Sending response: {response_data}")
                response = json.dumps(response_data)
                await asyncio.gather(*[client.send(response) for client in connected_clients])

            elif message_type == "notif":
                node_id = data.get("node_id", "Unknown")
                logger.debug(f"Received notification from node {node_id}")

                if node_id in clients_data:
                    intersection_id = int(clients_data[node_id]["intersection_id"])
                else:
                    latitude, longitude, intersection_id = await fetch_location_from_db(node_id, pool)

                await save_notification(node_id, intersection_id, pool)

                notif_data = {
                    "message_type": "notif",
                    "node_id": node_id
                }
                await asyncio.gather(*[client.send(json.dumps(notif_data)) for client in connected_clients])

            elif message_type == "config":
                logger.debug("Config message")
                logger.debug(f"Config message received: {data}")
                node_id, latitude, longitude, intersection_id = await insert_new_node(data, pool)
                clients_data[node_id] = {
                    "latitude": latitude,
                    "longitude": longitude,
                    "node_id": node_id,
                    "intersection_id": int(intersection_id)
                }
                config_response = {
                    "type": "config_response",
                    "data": {
                        "node_id": str(node_id),
                        "intersection_id": str(intersection_id),
                        "latitude": float(latitude),
                        "longitude": float(longitude),
                        "camera_count": data["data"]["camera_count"]
                    }
                }
                await websocket.send(json.dumps(config_response))
                logger.debug(f"Sent config_response to client: {config_response}")

                node_exists = False
                if pool is not None:
                    async with pool.acquire() as conn:
                        count = await conn.fetchval(
                            "SELECT COUNT(*) FROM nodes WHERE id = $1",
                            int(node_id)
                        )
                        node_exists = count > 0

                if node_exists:
                    update_node_data = {
                        "message_type": "node_update",
                        "node_id": node_id,
                        "latitude": float(latitude),
                        "longitude": float(longitude)
                    }
                    logger.debug(f"Broadcasting node_update for existing node: {update_node_data}")
                    await asyncio.gather(*[client.send(json.dumps(update_node_data)) for client in connected_clients])
                else:
                    new_node_data = {
                        "message_type": "new_node",
                        "node_id": node_id,
                        "latitude": float(latitude),
                        "longitude": float(longitude)
                    }
                    logger.debug(f"Broadcasting new node: {new_node_data}")
                    await asyncio.gather(*[client.send(json.dumps(new_node_data)) for client in connected_clients])

            else:
                logger.debug(f"Unknown message type: {message_type}")

    except websockets.exceptions.ConnectionClosed:
        logger.debug("Client disconnected")
    except Exception as e:
        logger.error(f"Error in handle_message: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        logger.debug(f"Refreshed clients_data: {clients_data}")

async def refresh_clients_data(pool):
    if pool is None:
        logger.debug("DEMO MODE: Skipping background clients data refresh")
        return
    while True:
        try:
            async with pool.acquire() as conn:
                results = await conn.fetch(
                    "SELECT nodes.id, intersections.latitude, intersections.longitude, nodes.intersection_id "
                    "FROM nodes JOIN intersections ON nodes.intersection_id = intersections.id"
                )
                for row in results:
                    node_id = str(row["id"])
                    clients_data[node_id] = {
                        "latitude": float(row["latitude"]),
                        "longitude": float(row["longitude"]),
                        "node_id": node_id,
                        "intersection_id": int(row["intersection_id"])
                    }
            logger.debug(f"Refreshed clients_data: {clients_data}")
        except Exception as e:
            logger.error(f"Error refreshing clients_data: {e}")
        await asyncio.sleep(60)

async def connection_handler(websocket, pool):
    try:
        await handle_message(websocket, pool)
    except Exception as e:
        logger.error(f"Error in connection_handler: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        logger.debug(f"Refreshed clients_data: {clients_data}")

async def get_database_pool():
    database_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    try:
        if database_url:
            pool = await asyncpg.create_pool(
                dsn=database_url,
                min_size=1,
                max_size=10,
                ssl="require",
                statement_cache_size=0
            )
            logger.info("Connected to Supabase database")
            return pool
        pool = await asyncpg.create_pool(
            host=os.getenv("PGHOST", "localhost"),
            port=int(os.getenv("PGPORT", 5432)),
            user=os.getenv("PGUSER", "postgres"),
            password=os.getenv("PGPASSWORD", "admin"),
            database=os.getenv("PGDATABASE", "trafficam_db"),
            min_size=1,
            max_size=10,
            statement_cache_size=0
        )
        logger.info("Connected to local PostgreSQL database")
        return pool
    except Exception as e:
        logger.warning(f"Failed to connect to database: {e}. Running in DEMO MODE (in-memory storage only)")
        return None

async def main():
    ipAddress = os.getenv("WEBSOCKET_HOST", "192.168.1.17")
    pool = await get_database_pool()
    asyncio.create_task(refresh_clients_data(pool))
    server = await websockets.serve(
        lambda ws: connection_handler(ws, pool),
        ipAddress,
        8765,
        ping_interval=20,
        ping_timeout=10,
        close_timeout=5
    )
    logger.info(f"WebSocket Server started on ws://{ipAddress}:8765")
    await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())