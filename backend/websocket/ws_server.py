import asyncio
from decimal import Decimal
import websockets
import json
import asyncpg
import logging
import redis.asyncio as aioredis

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stream names — one per message class
# ---------------------------------------------------------------------------
STREAM_TRAFFIC_DATA   = "traffic:data"
STREAM_TRAFFIC_NOTIF  = "traffic:notif"
STREAM_TRAFFIC_CONFIG = "traffic:config"

# Max entries kept in each stream (older ones are trimmed automatically).
# At 100 nodes x 1 msg/3s = ~2000 msgs/min. 10_000 = ~5 min of buffer.
STREAM_MAX_LEN = 10_000

# ---------------------------------------------------------------------------
# In-memory state (unchanged from original)
# ---------------------------------------------------------------------------
connected_clients = set()   # dashboard WebSocket connections
clients_data       = {}     # node_id -> {latitude, longitude, intersection_id}

# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

async def publish_to_stream(redis: aioredis.Redis, stream: str, fields: dict):
    """
    Write one message to a Redis Stream.
    
    XADD traffic:data * type vehicle_data node_id 42 payload '{"...":"..."}'
    
    We always store the original JSON payload as a single field so the
    consumer can deserialise it exactly once, without losing any fields.
    """
    try:
        entry_id = await redis.xadd(
            stream,
            fields,
            maxlen=STREAM_MAX_LEN,
            approximate=True   # '~' — faster, still accurate enough
        )
        logger.debug(f"XADD {stream} → {entry_id}  node_id={fields.get('node_id', '?')}")
        return entry_id
    except Exception as e:
        logger.error(f"Redis XADD failed on {stream}: {e}")
        return None

# ---------------------------------------------------------------------------
# Database helpers  (kept 100% identical to app_v3.py)
# ---------------------------------------------------------------------------

async def fetch_location_from_db(node_id, pool):
    async with pool.acquire() as conn:
        result = await conn.fetchrow(
            """
            SELECT intersections.latitude, intersections.longitude, nodes.intersection_id
            FROM intersections
            JOIN nodes ON intersections.id = nodes.intersection_id
            WHERE nodes.id = $1
            """,
            node_id
        )
        if result:
            return float(result['latitude']), float(result['longitude']), result['intersection_id']
        return None, None, None


async def insert_new_node(data, pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            latitude     = Decimal(str(data["data"]["coordinates"][0]["latitude"])).quantize(Decimal("0.000001"))
            longitude    = Decimal(str(data["data"]["coordinates"][0]["longitude"])).quantize(Decimal("0.000001"))
            camera_count = int(data["data"]["camera_count"])
            governorate  = data["data"].get("governorate", "Unknown")
            address      = data["data"].get("address", "Unknown Address")
            capacity     = int(data["data"].get("capacity", 20))
            node_id      = data["data"].get("node_id")
            node_id      = int(node_id) if node_id is not None else None

            # ── Atomic upsert on the UNIQUE (latitude, longitude) constraint ──
            # Cast $1/$2 explicitly to NUMERIC so asyncpg never sends them as FLOAT8.
            intersection_id = await conn.fetchval(
                """
                INSERT INTO intersections (governorate, address, latitude, longitude, capacity)
                VALUES ($1, $2, $3::NUMERIC(10,6), $4::NUMERIC(10,6), $5)
                ON CONFLICT (latitude, longitude)
                DO UPDATE SET
                    governorate = EXCLUDED.governorate,
                    address     = EXCLUDED.address,
                    capacity    = EXCLUDED.capacity
                RETURNING id
                """,
                governorate, address, latitude, longitude, capacity
            )

            # ── Find or create the node ──────────────────────────────────────
            node_result = None
            if node_id:
                node_result = await conn.fetchrow(
                    "SELECT id, intersection_id, cams FROM nodes WHERE id = $1",
                    node_id
                )
            if not node_result:
                node_result = await conn.fetchrow(
                    "SELECT id, intersection_id, cams FROM nodes WHERE intersection_id = $1 ORDER BY id ASC LIMIT 1",
                    intersection_id
                )

            if node_result:
                node_id = node_result['id']
                if node_result['cams'] != camera_count or node_result['intersection_id'] != intersection_id:
                    await conn.execute(
                        "UPDATE nodes SET intersection_id=$1, cams=$2 WHERE id=$3",
                        intersection_id, camera_count, node_id
                    )
            else:
                node_id = await conn.fetchval(
                    "INSERT INTO nodes (intersection_id, cams) VALUES ($1, $2) RETURNING id",
                    intersection_id, camera_count
                )

            # ── Refresh cameras ──────────────────────────────────────────────
            await conn.execute("DELETE FROM cams WHERE node_id = $1", node_id)
            for i in range(1, camera_count + 1):
                camera_data = data["data"].get(f"camera_{i}", {})
                if camera_data:
                    await conn.execute(
                        "INSERT INTO cams (node_id, lanes, ip_address) VALUES ($1, $2, $3)",
                        node_id,
                        camera_data.get("lane_number", 1),
                        camera_data.get("video_source", "")
                    )

            return node_id, latitude, longitude, intersection_id
# ---------------------------------------------------------------------------
# Phase 1 WebSocket handler — INGEST ONLY
#
# Each message type maps to its own stream. The raw JSON payload travels
# as a single field called "payload" so the consumer has everything it needs.
#
# For "config" messages we still do the DB write here (insert_new_node) and
# send the config_response directly back to the Jetson — because the node
# needs an immediate acknowledgement with its assigned node_id before it can
# send any traffic data. Everything else is deferred to the consumer.
# ---------------------------------------------------------------------------

async def handle_message(websocket, pool, redis):
    global connected_clients, clients_data
    connected_clients.add(websocket)

    try:
        async for raw_message in websocket:
            try:
                data         = json.loads(raw_message)
                message_type = data.get("type", "unknown")
                logger.debug(f"Ingest received type='{message_type}'")

                # ── vehicle_data ──────────────────────────────────────────
                if message_type == "vehicle_data":
                    node_id = data.get("data", {}).get("node_id", "unknown")
                    await publish_to_stream(
                        redis,
                        STREAM_TRAFFIC_DATA,
                        {
                            "node_id": str(node_id),
                            "payload": raw_message,   # raw JSON string, ready to parse
                        }
                    )

                # ── notif ─────────────────────────────────────────────────
                elif message_type == "notif":
                    node_id = data.get("node_id", "unknown")
                    await publish_to_stream(
                        redis,
                        STREAM_TRAFFIC_NOTIF,
                        {
                            "node_id": str(node_id),
                            "payload": raw_message,
                        }
                    )

                # ── config ────────────────────────────────────────────────
                # Config is handled synchronously here because the Jetson
                # must receive node_id back before it can send traffic data.
                elif message_type == "config":
                    logger.debug("Config message — processing synchronously")
                    node_id, latitude, longitude, intersection_id = await insert_new_node(data, pool)

                    clients_data[node_id] = {
                        "latitude": latitude,
                        "longitude": longitude,
                        "node_id": node_id,
                        "intersection_id": intersection_id
                    }

                    # Send config_response directly back to this Jetson node
                    config_response = {
                        "type": "config_response",
                        "data": {
                            "node_id":         str(node_id),
                            "intersection_id": str(intersection_id),
                            "latitude":        float(latitude),
                            "longitude":       float(longitude),
                            "camera_count":    data["data"]["camera_count"]
                        }
                    }
                    await websocket.send(json.dumps(config_response))
                    logger.debug(f"Sent config_response for node_id={node_id}")

                    # Also push to config stream so the consumer can broadcast
                    # new_node / node_update to the dashboard
                    await publish_to_stream(
                        redis,
                        STREAM_TRAFFIC_CONFIG,
                        {
                            "node_id":         str(node_id),
                            "latitude":        str(latitude),
                            "longitude":       str(longitude),
                            "intersection_id": str(intersection_id),
                            "camera_count":    str(data["data"]["camera_count"]),
                            "payload":         raw_message,
                        }
                    )

                else:
                    logger.debug(f"Unknown message type: {message_type}")

            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from node: {e}")
            except Exception as e:
                logger.error(f"Error processing message: {e}")

    except websockets.exceptions.ConnectionClosed:
        logger.debug("Node disconnected")
    finally:
        connected_clients.discard(websocket)
        logger.debug(f"Active dashboard clients: {len(connected_clients)}")


# ---------------------------------------------------------------------------
# Background task: refresh clients_data from DB (unchanged from original)
# ---------------------------------------------------------------------------

async def refresh_clients_data(pool):
    while True:
        try:
            async with pool.acquire() as conn:
                results = await conn.fetch(
                    """
                    SELECT nodes.id, intersections.latitude, intersections.longitude, nodes.intersection_id
                    FROM nodes
                    JOIN intersections ON nodes.intersection_id = intersections.id
                    """
                )
                for row in results:
                    node_id = str(row['id'])
                    clients_data[node_id] = {
                        "latitude":        float(row['latitude']),
                        "longitude":       float(row['longitude']),
                        "node_id":         node_id,
                        "intersection_id": str(row['intersection_id'])
                    }
        except Exception as e:
            logger.error(f"Error refreshing clients_data: {e}")
        await asyncio.sleep(60)


async def connection_handler(websocket, pool, redis):
    try:
        await handle_message(websocket, pool, redis)
    except Exception as e:
        logger.error(f"Error in connection_handler: {e}")
    finally:
        connected_clients.discard(websocket)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    ip_address = "0.0.0.0"

    # MySQL connection pool (unchanged)
    pool = await asyncpg.create_pool(
        host="localhost", user="postgres", password="admin",
        database="trafficam_db"
    )

    # Redis connection
    redis = aioredis.Redis(host="localhost", port=6379, decode_responses=True)
    try:
        await redis.ping()
        logger.info("Connected to Redis")
    except Exception as e:
        logger.error(f"Cannot connect to Redis: {e}")
        raise

    # Background task to keep clients_data fresh
    asyncio.create_task(refresh_clients_data(pool))

    # WebSocket server — nodes connect here
    server = await websockets.serve(
        lambda ws: connection_handler(ws, pool, redis),
        ip_address,
        8765,
        ping_interval=20,
        ping_timeout=10,
        close_timeout=5
    )

    logger.info(f"Phase 1 ingest server started on ws://{ip_address}:8765")
    logger.info(f"Streams: {STREAM_TRAFFIC_DATA} | {STREAM_TRAFFIC_NOTIF} | {STREAM_TRAFFIC_CONFIG}")
    await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
