import asyncio
import websockets
import json
import aiomysql
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Store connected WebSocket clients
connected_clients = set()

# Store additional data for each client
clients_data = {}

# Fetch lat/lon and intersection_id from MySQL using node_id
async def fetch_location_from_db(node_id, pool):
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Ensure fresh data by disabling query caching
            await cur.execute("SET SESSION query_cache_type = OFF")
            await cur.execute(
                """
                SELECT intersections.latitude, intersections.longitude, nodes.intersection_id 
                FROM intersections 
                JOIN nodes ON intersections.id = nodes.intersection_id 
                WHERE nodes.id = %s
                """, 
                (node_id,)
            )
            result = await cur.fetchone()
            if result:
                latitude, longitude, intersection_id = result
                logger.debug(f"Fetched location for node_id={node_id}: latitude={latitude}, longitude={longitude}")
                return float(latitude), float(longitude), intersection_id
            logger.debug(f"No location found for node_id={node_id}")
            return None, None, None

# Insert new intersection, node, and cameras into the database
async def insert_new_node(data, pool):
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            latitude = data["data"]["coordinates"][0]["latitude"]
            longitude = data["data"]["coordinates"][0]["longitude"]
            camera_count = data["data"]["camera_count"]
            governorate = data["data"].get("governorate", "Unknown")
            address = data["data"].get("address", "Unknown Address")
            capacity = data["data"].get("capacity", 20)
            node_id = data["data"].get("node_id")  

            # Check for existing intersection
            await cur.execute(
                """
                SELECT id FROM intersections 
                WHERE latitude = %s AND longitude = %s AND address = %s
                """,
                (latitude, longitude, address)
            )
            intersection_result = await cur.fetchone()

            if intersection_result:
                intersection_id = intersection_result[0]
                logger.debug("Updated node")
                # Update intersection details
                await cur.execute(
                    """
                    UPDATE intersections 
                    SET governorate = %s, address = %s, latitude = %s, longitude = %s, capacity = %s
                    WHERE id = %s
                    """,
                    (governorate, address, latitude, longitude, capacity, intersection_id)
                )
                logger.debug(f"Updated intersection: intersection_id={intersection_id}")
            else:
                # Insert new intersection
                await cur.execute(
                    """
                    INSERT INTO intersections (governorate, address, latitude, longitude, capacity)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (governorate, address, latitude, longitude, capacity)
                )
                intersection_id = cur.lastrowid
                logger.debug(f"Inserted new intersection: intersection_id={intersection_id}")

            # Check for existing node
            if node_id:
                await cur.execute(
                    """
                    SELECT id, intersection_id, cams FROM nodes 
                    WHERE id = %s
                    """,
                    (node_id,)
                )
            else:
                await cur.execute(
                    """
                    SELECT id, intersection_id, cams FROM nodes 
                    WHERE intersection_id = %s AND cams = %s
                    """,
                    (intersection_id, camera_count)
                )
            node_result = await cur.fetchone()

            if node_result:
                node_id = node_result[0]
                existing_intersection_id = node_result[1]
                existing_camera_count = node_result[2]
                # Update node if camera count has changed
                if existing_camera_count != camera_count or existing_intersection_id != intersection_id:
                    await cur.execute(
                        """
                        UPDATE nodes 
                        SET intersection_id = %s, cams = %s
                        WHERE id = %s
                        """,
                        (intersection_id, camera_count, node_id)
                    )
                    logger.debug(f"Updated node: node_id={node_id}, cams={camera_count}")
                else:
                    logger.debug(f"Node already exists: node_id={node_id}")
            else:
                # Insert new node
                await cur.execute(
                    """
                    INSERT INTO nodes (intersection_id, cams)
                    VALUES (%s, %s)
                    """,
                    (intersection_id, camera_count)
                )
                node_id = cur.lastrowid
                logger.debug(f"Inserted new node: node_id={node_id}")

            # Delete existing camera records for this node
            await cur.execute(
                """
                DELETE FROM cams WHERE node_id = %s
                """,
                (node_id,)
            )

            # Insert updated camera records
            for i in range(1, camera_count + 1):
                camera_data = data["data"].get(f"camera_{i}", {})
                if camera_data:
                    stream_url = camera_data.get("video_source", "")
                    lane_number = camera_data.get("lane_number", 1)
                    logger.debug(f"Inserting camera {i} with stream_url: {stream_url}")
                    await cur.execute(
                        """
                        INSERT INTO cams (node_id, lanes, ip_address)
                        VALUES (%s, %s, %s)
                        """,
                        (node_id, lane_number, stream_url)
                    )

            await conn.commit()
            logger.debug(f"Committed node configuration: node_id={node_id}, intersection_id={intersection_id}")
            return node_id, latitude, longitude, intersection_id

# Save message to history table
async def save_to_history(data, intersection_id, pool):
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            vehicles_count = data.get("vehicles", 0)
            total_passed = 0
            for i in range(1, 5):
                key = f"voie_{i}"
                if key in data:
                    total_passed += data[key]
            # Average all available speeds (up to four)
            speeds = [data.get(f"avg_speed_{i}", 0) for i in range(1, 5) if f"avg_speed_{i}" in data]
            if data.get("avg_speed") is not None:
                speeds.append(data["avg_speed"])
            avg_speed = sum(speeds) / len(speeds) if speeds else 0
            
            await cur.execute(
                """
                INSERT INTO history (intersection_id, vehicles_count, total_passed, avg_speed)
                VALUES (%s, %s, %s, %s)
                """,
                (intersection_id, vehicles_count, total_passed, avg_speed)
            )
            await conn.commit()

async def save_notification(node_id, intersection_id, pool):
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            severity = 3  
            content = "Traffic jam"  
            
            await cur.execute(
                """
                INSERT INTO notifications (intersection_id, severety, content)
                VALUES (%s, %s, %s)
                """,
                (intersection_id, severity, content)
            )
            await conn.commit()
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
                        "intersection_id": intersection_id
                    }
                    logger.debug(f"New node connected: {node_id} at ({latitude}, {longitude})")
                else:
                    # Refresh coordinates to ensure consistency
                    latitude, longitude, intersection_id = await fetch_location_from_db(node_id, pool)
                    if latitude is None or longitude is None or intersection_id is None:
                        await websocket.send(json.dumps({"error": "Node ID not found in database"}))
                        continue
                    clients_data[node_id].update({
                        "latitude": latitude,
                        "longitude": longitude,
                        "intersection_id": intersection_id
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

                # Fetch intersection_id
                if node_id in clients_data:
                    intersection_id = clients_data[node_id]["intersection_id"]
                else:
                    latitude, longitude, intersection_id = await fetch_location_from_db(node_id, pool)

                # Save notification to database
                await save_notification(node_id, intersection_id, pool)

                # Send notification
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
                    "intersection_id": intersection_id
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

                # Check if this is an update to an existing node
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            SELECT COUNT(*) FROM nodes WHERE id = %s
                            """,
                            (node_id,)
                        )
                        node_exists = (await cur.fetchone())[0] > 0

                if node_exists:
                    # Send node_update for existing nodes
                    update_node_data = {
                        "message_type": "node_update",
                        "node_id": node_id,
                        "latitude": float(latitude),
                        "longitude": float(longitude)
                    }
                    logger.debug(f"Broadcasting node_update for existing node: {update_node_data}")
                    await asyncio.gather(*[client.send(json.dumps(update_node_data)) for client in connected_clients])
                else:
                    # Send new_node for new nodes
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
    while True:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        SELECT nodes.id, intersections.latitude, intersections.longitude, nodes.intersection_id
                        FROM nodes
                        JOIN intersections ON nodes.intersection_id = intersections.id
                        """
                    )
                    results = await cur.fetchall()
                    for row in results:
                        node_id = str(row[0])
                        clients_data[node_id] = {
                            "latitude": float(row[1]),
                            "longitude": float(row[2]),
                            "node_id": node_id,
                            "intersection_id": str(row[3])
                        }
            logger.debug(f"Refreshed clients_data: {clients_data}")
        except Exception as e:
            logger.error(f"Error refreshing clients_data: {e}")
        await asyncio.sleep(60)  # Refresh every 1 min 

async def connection_handler(websocket, pool):
    try:
        await handle_message(websocket, pool)
    except Exception as e:
        logger.error(f"Error in connection_handler: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        logger.debug(f"Refreshed clients_data: {clients_data}")

async def main():
    ipAddress = "192.168.1.16"
    pool = await aiomysql.create_pool(
        host="localhost", user="root", password="", db="traffic_control_db", autocommit=True
    )
    asyncio.create_task(refresh_clients_data(pool))  # Start background task
    server = await websockets.serve(
        lambda ws: connection_handler(ws, pool),  # Pass pool to connection_handler
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