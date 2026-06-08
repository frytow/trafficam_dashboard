"""
consumer.py  —  Phase 3 Redis Streams consumer worker

Reads from the three streams written by app_phase1.py:
  • traffic:data    →  save_to_history()  +  broadcast "data" to dashboards
  • traffic:notif   →  save_notification() +  broadcast "notif" to dashboards
  • traffic:config  →  broadcast "new_node" to dashboards

Phase 3 additions:
  • Dead letter handling  — messages that fail > MAX_RETRIES times are moved
                            to traffic:dead and acknowledged so they stop blocking
  • Stream health monitor — logs lag, PEL size, and stream length every
                            MONITOR_INTERVAL_SEC seconds
  • Graceful shutdown     — SIGINT/SIGTERM finishes the current batch before exit

Run alongside app_phase1.py:
    python app_phase1.py   &   python consumer.py
"""

import asyncio
import json
import logging
import signal
import websockets
import asyncpg
import redis.asyncio as aioredis

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
IP_ADDRESS     = "172.16.9.121"
DASHBOARD_PORT = 8766          # dashboards connect here (map_v3.js change: ws://…:8766)

STREAM_DATA    = "traffic:data"
STREAM_NOTIF   = "traffic:notif"
STREAM_CONFIG  = "traffic:config"

GROUP_NAME     = "dashboard-consumer"
CONSUMER_NAME  = "worker-1"

BLOCK_MS       = 2000   # how long XREADGROUP blocks waiting for new messages
BATCH_SIZE     = 50     # max messages to read per stream per iteration

# Phase 3 — observability & resilience
STREAM_DEAD        = "traffic:dead"   # dead letter stream
MAX_RETRIES        = 3                # move to dead letter after this many failures
MONITOR_INTERVAL   = 30              # seconds between health-check log lines
STREAM_LAG_WARN    = 500             # warn if a stream has more than this many unread messages
PEL_WARN           = 50              # warn if pending entry list exceeds this count

# Graceful shutdown flag — set by signal handler, checked in consume()
_shutdown = False

# ---------------------------------------------------------------------------
# Shared dashboard client registry
# ---------------------------------------------------------------------------
dashboard_clients: set = set()


async def broadcast(message: dict):
    """Send a JSON message to every connected dashboard client."""
    if not dashboard_clients:
        return
    payload = json.dumps(message)
    results = await asyncio.gather(
        *[client.send(payload) for client in dashboard_clients],
        return_exceptions=True
    )
    for client, result in zip(list(dashboard_clients), results):
        if isinstance(result, Exception):
            logger.warning(f"Dashboard client send failed: {result}")
            dashboard_clients.discard(client)


# ---------------------------------------------------------------------------
# Dashboard WebSocket endpoint  (dashboards connect here)
# ---------------------------------------------------------------------------

async def dashboard_handler(websocket):
    """Accept and track dashboard connections."""
    dashboard_clients.add(websocket)
    logger.info(f"Dashboard connected. Total: {len(dashboard_clients)}")
    try:
        await websocket.wait_closed()
    finally:
        dashboard_clients.discard(websocket)
        logger.info(f"Dashboard disconnected. Total: {len(dashboard_clients)}")


# ---------------------------------------------------------------------------
# DB helpers  (identical logic to app_v3.py)
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


async def save_to_history(data: dict, intersection_id: int, pool):
    async with pool.acquire() as conn:
        vehicles_count = data.get("vehicles", 0)

        total_passed = 0
        for i in range(1, 5):
            key = f"voie_{i}"
            if key in data:
                total_passed += data[key]

        speeds = [data.get(f"avg_speed_{i}", 0) for i in range(1, 5) if f"avg_speed_{i}" in data]
        if data.get("avg_speed") is not None:
            speeds.append(data["avg_speed"])
        avg_speed = sum(speeds) / len(speeds) if speeds else 0

        await conn.execute(
            """
            INSERT INTO history (intersection_id, vehicles_count, total_passed, avg_speed)
            VALUES ($1, $2, $3, $4)
            """,
            intersection_id, vehicles_count, total_passed, avg_speed
        )
        logger.debug(f"Saved history: intersection_id={intersection_id}, vehicles={vehicles_count}")


async def save_notification(intersection_id: int, pool):
    async with pool.acquire() as conn:
        severity = 3
        content  = "Traffic jam"
        await conn.execute(
            """
            INSERT INTO notifications (intersection_id, severity, content)
            VALUES ($1, $2, $3)
            """,
            intersection_id, severity, content
        )
        logger.debug(f"Saved notification: intersection_id={intersection_id}")


# ---------------------------------------------------------------------------
# Stream consumer group setup
# ---------------------------------------------------------------------------

async def ensure_consumer_groups(redis: aioredis.Redis):
    """
    Create consumer groups if they don't exist yet.
    '0' means start reading from the very beginning of the stream.
    If the stream doesn't exist yet, MKSTREAM creates it.
    """
    for stream in (STREAM_DATA, STREAM_NOTIF, STREAM_CONFIG):
        try:
            await redis.xgroup_create(stream, GROUP_NAME, id="0", mkstream=True)
            logger.info(f"Created consumer group '{GROUP_NAME}' on '{stream}'")
        except aioredis.ResponseError as e:
            if "BUSYGROUP" in str(e):
                logger.debug(f"Consumer group already exists on '{stream}', continuing")
            else:
                raise


# ---------------------------------------------------------------------------
# Phase 3 — Dead letter handling
# ---------------------------------------------------------------------------

async def dead_letter(
    redis: aioredis.Redis,
    stream: str,
    entry_id: str,
    fields: dict,
    reason: str,
):
    """
    Move a repeatedly-failing message to traffic:dead and acknowledge it
    so it no longer blocks the pending entry list.

    The dead letter entry records:
      - which stream it came from
      - the original entry_id
      - the failure reason
      - the original fields (payload intact for manual inspection/replay)
    """
    dead_fields = {
        "source_stream": stream,
        "original_id":   entry_id,
        "reason":        reason,
        "node_id":       fields.get("node_id", "unknown"),
        "payload":       fields.get("payload", ""),
    }
    await redis.xadd(STREAM_DEAD, dead_fields)
    await redis.xack(stream, GROUP_NAME, entry_id)
    logger.error(
        f"DEAD LETTER — moved {entry_id} from {stream} to {STREAM_DEAD} "
        f"(node_id={fields.get('node_id','?')}, reason={reason})"
    )


async def check_retry_count(
    redis: aioredis.Redis,
    stream: str,
    entry_id: str,
    fields: dict,
    error: Exception,
) -> bool:
    """
    Check how many times this entry has been delivered.
    If it exceeds MAX_RETRIES, dead-letter it and return True (caller should skip).
    Otherwise return False (caller should leave it pending for next restart).
    """
    try:
        # XPENDING with a specific entry id returns delivery count
        pending = await redis.xpending_range(stream, GROUP_NAME, entry_id, entry_id, 1)
        if pending:
            delivery_count = pending[0].get("times_delivered", 0)
            if delivery_count > MAX_RETRIES:
                await dead_letter(redis, stream, entry_id, fields, str(error))
                return True
    except Exception as e:
        logger.warning(f"Could not check retry count for {entry_id}: {e}")
    return False


# ---------------------------------------------------------------------------
# Phase 3 — Stream health monitor
# ---------------------------------------------------------------------------

async def monitor_streams(redis: aioredis.Redis):
    """
    Every MONITOR_INTERVAL seconds, log the health of each stream:
      • stream length  (total entries, trimmed by STREAM_MAX_LEN in ingest)
      • consumer group lag  (entries not yet delivered to any consumer)
      • PEL count  (delivered but not yet acknowledged — sign of failures)

    Emits WARNING lines when thresholds are exceeded so they stand out in logs.
    """
    while not _shutdown:
        await asyncio.sleep(MONITOR_INTERVAL)
        try:
            for stream in (STREAM_DATA, STREAM_NOTIF, STREAM_CONFIG):
                # Overall stream length
                length = await redis.xlen(stream)

                # Consumer group info
                groups = await redis.xinfo_groups(stream)
                for group in groups:
                    if group["name"] != GROUP_NAME:
                        continue
                    lag = group.get("lag", 0) or 0        # undelivered messages
                    pel = group.get("pel-count", 0) or 0  # pending (delivered, not acked)

                    level = logging.WARNING if (lag > STREAM_LAG_WARN or pel > PEL_WARN) else logging.INFO
                    logger.log(
                        level,
                        f"[MONITOR] {stream:20s}  length={length:>6}  "
                        f"lag={lag:>5}  pel={pel:>4}"
                        + (" ⚠ HIGH LAG"  if lag > STREAM_LAG_WARN else "")
                        + (" ⚠ HIGH PEL"  if pel > PEL_WARN        else "")
                    )

            # Dead letter stream length (always warn if non-zero)
            dead_len = await redis.xlen(STREAM_DEAD)
            if dead_len:
                logger.warning(f"[MONITOR] {STREAM_DEAD:20s}  {dead_len} dead-lettered message(s) — inspect with: redis-cli XRANGE traffic:dead - +")

        except Exception as e:
            logger.error(f"Monitor error: {e}")




async def process_data(entry_id: str, fields: dict, pool, redis: aioredis.Redis):
    """Handle one traffic:data entry."""
    try:
        raw          = fields.get("payload", "{}")
        message      = json.loads(raw)
        node_id      = int(fields.get("node_id", 0))
        nested_data  = message.get("data", {})
        vehicle_data = nested_data.get("vehicle_data", [])

        latitude, longitude, intersection_id = await fetch_location_from_db(node_id, pool)
        if intersection_id is None:
            logger.warning(f"No DB record for node_id={node_id}, skipping")
            await redis.xack(STREAM_DATA, GROUP_NAME, entry_id)
            return

        # ── Flatten camera/lane data (identical logic to app_v3.py) ──────────
        vehicles_count = 0
        lane_data      = {}
        lane_speeds    = {}
        lane_mapping   = {}
        current_lane   = 1

        # First pass: build a stable lane mapping across all cameras
        for camera_data in vehicle_data:
            camera_id   = camera_data.get("camera_id")
            lane_counts = camera_data.get("lane_counts", [])
            for lane in lane_counts:
                lane_mapping[(camera_id, lane["lane"])] = current_lane
                current_lane += 1

        # Second pass: aggregate counts and speeds
        for camera_data in vehicle_data:
            camera_id   = camera_data.get("camera_id")
            lane_counts = camera_data.get("lane_counts", [])
            avg_speeds  = camera_data.get("avg_speeds", [])

            vehicles_count += sum(lane["count"] for lane in lane_counts)

            for lane in lane_counts:
                mapped = lane_mapping.get((camera_id, lane["lane"]), lane["lane"])
                lane_data[f"voie_{mapped}"] = lane_data.get(f"voie_{mapped}", 0) + lane["count"]

            for speed in avg_speeds:
                mapped = lane_mapping.get((camera_id, speed["lane"]), speed["lane"])
                lane_speeds.setdefault(mapped, []).append(speed["speed_kmh"])

        # Build speed_data — single avg_speed for 1-lane nodes, per-lane otherwise
        speed_data   = {}
        unique_lanes = sorted(lane_data.keys(), key=lambda x: int(x.split("_")[1]))

        if len(unique_lanes) == 1:
            lane_num   = int(unique_lanes[0].split("_")[1])
            speeds     = lane_speeds.get(lane_num, [])
            speed_data["avg_speed"] = round(sum(speeds) / len(speeds), 2) if speeds else 0
        else:
            for lane_key in unique_lanes:
                lane_num   = int(lane_key.split("_")[1])
                speeds     = lane_speeds.get(lane_num, [])
                speed_data[f"avg_speed_{lane_num}"] = round(sum(speeds) / len(speeds), 2) if speeds else 0

        # ── Build response — node_id as STRING to match dashboard layer keys ─
        response_data = {
            "message_type": "data",
            "node_id":       str(node_id),   # string — JS nodeLayers keyed by string
            "latitude":      latitude,
            "longitude":     longitude,
            "vehicles":      vehicles_count,
            **lane_data,
            **speed_data,
        }

        await save_to_history(response_data, intersection_id, pool)
        await broadcast(response_data)

        await redis.xack(STREAM_DATA, GROUP_NAME, entry_id)
        logger.debug(f"Processed data entry {entry_id} for node_id={node_id}")

    except Exception as e:
        logger.error(f"Error processing data entry {entry_id}: {e}")
        await check_retry_count(redis, STREAM_DATA, entry_id, fields, e)


async def process_notif(entry_id: str, fields: dict, pool, redis: aioredis.Redis):
    """Handle one traffic:notif entry."""
    try:
        node_id = int(fields.get("node_id", 0))

        _, _, intersection_id = await fetch_location_from_db(node_id, pool)
        if intersection_id is None:
            logger.warning(f"No DB record for node_id={node_id}, skipping notif")
            await redis.xack(STREAM_NOTIF, GROUP_NAME, entry_id)
            return

        await save_notification(intersection_id, pool)

        notif_data = {
            "message_type": "notif",
            "node_id":       str(node_id),   # string — matches dashboard layer keys
        }
        await broadcast(notif_data)

        await redis.xack(STREAM_NOTIF, GROUP_NAME, entry_id)
        logger.debug(f"Processed notif entry {entry_id} for node_id={node_id}")

    except Exception as e:
        logger.error(f"Error processing notif entry {entry_id}: {e}")
        await check_retry_count(redis, STREAM_NOTIF, entry_id, fields, e)


async def process_config(entry_id: str, fields: dict, redis: aioredis.Redis):
    """
    Handle one traffic:config entry.
    The DB write + config_response already happened in app_phase1.py.
    Here we only broadcast new_node to dashboards.
    """
    try:
        node_id   = int(fields.get("node_id", 0))
        latitude  = float(fields.get("latitude", 0))
        longitude = float(fields.get("longitude", 0))

        new_node_data = {
            "message_type": "new_node",
            "node_id":       str(node_id),   # string — matches dashboard layer keys
            "latitude":      latitude,
            "longitude":     longitude,
        }
        await broadcast(new_node_data)

        await redis.xack(STREAM_CONFIG, GROUP_NAME, entry_id)
        logger.debug(f"Processed config entry {entry_id} for node_id={node_id}")

    except Exception as e:
        logger.error(f"Error processing config entry {entry_id}: {e}")
        await check_retry_count(redis, STREAM_CONFIG, entry_id, fields, e)


# ---------------------------------------------------------------------------
# Main consumer loop
# ---------------------------------------------------------------------------

async def consume(pool, redis: aioredis.Redis):
    """
    Continuously read from all three streams in one XREADGROUP call.
    On each iteration:
      1. Check for unacknowledged (pending) messages from a previous crash  →  '0'
      2. Once caught up, block-wait for new messages                        →  '>'

    Exits cleanly when _shutdown is set by the signal handler.
    """
    global _shutdown

    # Start by recovering any pending messages from a previous crash
    start_ids = {
        STREAM_DATA:   "0",
        STREAM_NOTIF:  "0",
        STREAM_CONFIG: "0",
    }

    logger.info("Consumer loop started — checking for pending messages first")

    while not _shutdown:
        try:
            results = await redis.xreadgroup(
                groupname    = GROUP_NAME,
                consumername = CONSUMER_NAME,
                streams      = start_ids,
                count        = BATCH_SIZE,
                block        = BLOCK_MS,
            )

            if not results:
                if any(v == "0" for v in start_ids.values()):
                    logger.info("No pending messages — switching to live mode (>)")
                    start_ids = {
                        STREAM_DATA:   ">",
                        STREAM_NOTIF:  ">",
                        STREAM_CONFIG: ">",
                    }
                continue

            for stream_name, entries in results:
                for entry_id, fields in entries:
                    if _shutdown:
                        # Finish current entry, then exit on next loop iteration
                        logger.info("Shutdown signal received — finishing current entry then stopping")
                    if stream_name == STREAM_DATA:
                        await process_data(entry_id, fields, pool, redis)
                    elif stream_name == STREAM_NOTIF:
                        await process_notif(entry_id, fields, pool, redis)
                    elif stream_name == STREAM_CONFIG:
                        await process_config(entry_id, fields, redis)

            if any(v == "0" for v in start_ids.values()):
                start_ids = {
                    STREAM_DATA:   ">",
                    STREAM_NOTIF:  ">",
                    STREAM_CONFIG: ">",
                }

        except aioredis.ConnectionError as e:
            logger.error(f"Redis connection lost: {e} — retrying in 2s")
            await asyncio.sleep(2)
        except Exception as e:
            logger.error(f"Unexpected consumer error: {e}")
            await asyncio.sleep(1)

    logger.info("Consumer loop exited cleanly")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    global _shutdown

    # ── Graceful shutdown signal handler ────────────────────────────────────
    def _handle_shutdown(sig):
        global _shutdown
        logger.info(f"Received signal {sig.name} — shutting down after current batch")
        _shutdown = True

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_shutdown, sig)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler for all signals
            signal.signal(sig, lambda s, f: _handle_shutdown(s))

    # ── DB + Redis ───────────────────────────────────────────────────────────
    pool = await asyncpg.create_pool(
        host="localhost", user="postgres", password="admin",
        database="trafficam_db"
    )

    redis = aioredis.Redis(host="localhost", port=6379, decode_responses=True)
    await redis.ping()
    logger.info("Consumer connected to Redis")

    await ensure_consumer_groups(redis)

    # ── Dashboard WebSocket server ───────────────────────────────────────────
    dashboard_server = await websockets.serve(
        dashboard_handler,
        IP_ADDRESS,
        DASHBOARD_PORT,
        ping_interval=20,
        ping_timeout=10,
    )
    logger.info(f"Dashboard WebSocket ready on ws://{IP_ADDRESS}:{DASHBOARD_PORT}")
    logger.info(f"Dead letter stream: {STREAM_DEAD}  |  Max retries: {MAX_RETRIES}  |  Monitor interval: {MONITOR_INTERVAL}s")

    # ── Run consumer loop + monitor + dashboard server together ─────────────
    await asyncio.gather(
        dashboard_server.wait_closed(),
        consume(pool, redis),
        monitor_streams(redis),
    )


if __name__ == "__main__":
    asyncio.run(main())