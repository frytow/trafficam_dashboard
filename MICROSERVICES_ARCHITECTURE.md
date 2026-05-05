# TrafficCAM - Microservices Architecture Plan

**Date:** April 30, 2026  
**Team:** 2 Developers × 2 Months  
**Target:** Production-ready 4 independent microservices  

---

## 1. ARCHITECTURE OVERVIEW

### 4 Independent Microservices

```
┌─────────────────────────────────────────────────────────────┐
│                     MICROSERVICES TOPOLOGY                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │   100 IoT Nodes  │  │  Mobile Clients  │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                          │
│  ┌────────▼──────────────────────▼──┐                      │
│  │  SERVICE 1: WebSocket API        │                      │
│  │  (Port 8765)                     │                      │
│  │  ├─ Receive sensor data          │                      │
│  │  ├─ Validate & enrich            │                      │
│  │  ├─ Queue to Redis Streams       │                      │
│  │  └─ Broadcast alerts via Pub/Sub │                      │
│  └────────┬───────────────────────┬─┘                      │
│           │                       │                        │
│  ┌────────▼──────────────────────▼──┐                      │
│  │   REDIS STREAMS + PUB/SUB          │                      │
│  │   (Single Instance - Message Hub)  │                      │
│  │   ├─ traffic_stream (raw data)     │                      │
│  │   ├─ alerts_stream (incidents)     │                      │
│  │   ├─ alerts_channel (real-time)    │                      │
│  │   └─ Cache layer                   │                      │
│  └────────┬──────────────────────────┘                      │
│           │                                                 │
│  ┌────────▼────────────┐                                   │
│  │ SERVICE 2:          │                                   │
│  │ Worker Pool         │                                   │
│  │ (Port: None)        │                                   │
│  │ ├─ Process queue    │                                   │
│  │ ├─ 4-8 instances    │                                   │
│  │ └─ Write to DB      │                                   │
│  └────────┬────────────┘                                   │
│           │                                                 │
│  ┌────────▼────────────┐        ┌──────────────────┐      │
│  │ SERVICE 3:          │        │ SERVICE 4:       │      │
│  │ HTTP REST API       │        │ Alert Engine     │      │
│  │ (Port 5000)         │        │ (Port: None)     │      │
│  │ ├─ Query data       │        │ ├─ Real-time     │      │
│  │ ├─ Aggregates       │        │ │  detection     │      │
│  │ └─ Connection pool  │        │ └─ Pub/Sub       │      │
│  └────────┬────────────┘        └────────┬─────────┘      │
│           │                              │                 │
│  ┌────────▼──────────────────────────────▼──┐              │
│  │   TimescaleDB (PostgreSQL)                │              │
│  │   ├─ Raw data (24h, then compressed)     │              │
│  │   ├─ Hourly aggregates (infinite)        │              │
│  │   └─ Alerts & incidents table            │              │
│  └──────────────────────────────────────────┘              │
│           │                                                 │
│  ┌────────▼──────────────────────────────────┐            │
│  │  Frontend Dashboard + Mobile App          │            │
│  │  (Consumes hourly aggregates only)        │            │
│  └────────────────────────────────────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. SERVICE SPECIFICATIONS

### SERVICE 1: WebSocket API (Data Ingestion)

**Purpose:** Receive real-time data from 100 IoT nodes  
**Language:** Python (FastAPI + websockets)  
**Port:** 8765  
**Instances:** 1 (can scale horizontally later)  
**Responsibilities:**
- Accept WebSocket connections from IoT nodes
- Validate incoming data format
- Enrich with metadata (timestamp, server IP)
- Queue to Redis Streams (`traffic_stream`)
- Send immediate ACK to IoT node
- Handle disconnections gracefully

**Key Files to Create/Modify:**
```
backend/websocket/
├── app_v3.py (REFACTOR)
├── models.py (NEW - Pydantic schemas)
├── handlers.py (NEW - Message handling)
├── redis_queue.py (NEW - Redis client)
└── tests/ (NEW)
    └── test_websocket.py
```

**Core Logic:**
```python
# Pseudo-code
@websocket_endpoint
async def receive_sensor_data(websocket):
    client_id = websocket.client[0]
    
    async for message in websocket:
        # 1. Validate
        data = validate_sensor_data(message)
        
        # 2. Enrich
        data['timestamp'] = datetime.now()
        data['server'] = get_local_ip()
        
        # 3. Queue (fast, fire-and-forget)
        await redis.xadd('traffic_stream', data)
        
        # 4. ACK (client gets response immediately)
        await websocket.send_text("ACK")
        
        # 5. Broadcast if alert
        if is_alert(data):
            await redis.publish('alerts_channel', data)
```

**Deployment:**
- Docker container
- Environment: Production
- Health check: /health endpoint
- Memory: 512 MB
- CPU: 1 core

---

### SERVICE 2: Worker Pool (Data Processing)

**Purpose:** Process queue, transform data, write to database  
**Language:** Python (Async)  
**Port:** None (background service)  
**Instances:** 4-8 workers (configurable)  
**Responsibilities:**
- Read from Redis Streams consumer group (`traffic_stream`)
- Batch process messages (100 per batch)
- Transform data for storage
- Write to TimescaleDB
- Mark messages as processed
- Handle dead-letter queue for failures

**Key Files to Create/Modify:**
```
backend/workers/
├── app.py (NEW - Main worker)
├── models.py (NEW - Data models)
├── transformers.py (NEW - Data transformation)
├── database.py (NEW - TimescaleDB client)
├── config.py (NEW - Worker configuration)
└── tests/ (NEW)
    └── test_workers.py
```

**Core Logic:**
```python
# Pseudo-code
async def worker_main():
    redis_client = get_redis()
    db_pool = get_db_pool()
    
    # Create consumer group
    await redis_client.xgroup_create('traffic_stream', 'workers')
    
    while True:
        # Read 100 messages (batch)
        messages = await redis_client.xreadgroup(
            'workers', 
            'traffic_stream',
            count=100,
            block=1000
        )
        
        if not messages:
            continue
        
        # Batch insert
        async with db_pool.acquire() as conn:
            await conn.executemany(
                'INSERT INTO traffic_data (...)',
                transform_batch(messages)
            )
        
        # Mark as processed
        for msg_id in message_ids:
            await redis_client.xack('traffic_stream', 'workers', msg_id)
```

**Deployment:**
- Docker container (replicated 4-8 times)
- Environment: Production
- Memory: 256 MB per instance
- CPU: 0.5 core per instance
- Auto-restart on failure

---

### SERVICE 3: HTTP REST API (Query Interface)

**Purpose:** Serve queries to frontend/mobile with caching  
**Language:** Python (FastAPI)  
**Port:** 5000  
**Instances:** 2 (behind load balancer)  
**Responsibilities:**
- Query aggregated data from TimescaleDB
- Cache results in Redis (cache-aside pattern)
- Return hourly aggregates to frontend (not raw points)
- Support filtering by intersection/corridor
- Return configuration (IP, settings)
- Connection pooling to database

**Key Files to Create/Modify:**
```
backend/http/
├── serverAppV2.py (REFACTOR)
├── routes/
│   ├── intersections.py (NEW)
│   ├── aggregates.py (NEW)
│   ├── alerts.py (NEW)
│   ├── config.py (NEW)
│   └── health.py (NEW)
├── cache.py (NEW - Redis cache layer)
├── database.py (NEW - Connection pool)
├── schemas.py (NEW - Pydantic models)
└── tests/ (NEW)
    └── test_api.py
```

**Endpoints:**
```
GET  /health                          → Service health
GET  /api/config                      → IP, settings
GET  /api/aggregates?hours=24         → 24 hourly points
GET  /api/intersections               → All intersections
GET  /api/intersection/:id/data       → Specific data
GET  /api/alerts?limit=50             → Recent alerts
POST /api/alerts/subscribe            → Alert subscription
```

**Caching Strategy:**
```
Cache Key: agg:intersection:{id}:date:{date}:hour:{hour}
TTL: 3600 seconds (1 hour)

Pattern:
1. Check Redis cache
2. If miss, query TimescaleDB
3. Store result in Redis
4. Return to client
```

**Deployment:**
- Docker container (2 instances)
- Environment: Production
- Memory: 512 MB per instance
- CPU: 1 core per instance
- Load balancer: Nginx or HAProxy

---

### SERVICE 4: Alert Engine (Real-Time Incident Detection)

**Purpose:** Detect incidents and broadcast in real-time  
**Language:** Python (Async)  
**Port:** None (background service)  
**Instances:** 1 (can be redundant for HA)  
**Responsibilities:**
- Read alerts from Redis Streams (`alerts_stream`)
- Apply detection rules (congestion, incident, accident)
- Store alerts in TimescaleDB
- Broadcast to WebSocket clients via Redis Pub/Sub
- Calculate incident severity
- Send notifications

**Key Files to Create/Modify:**
```
backend/alerts/
├── engine.py (NEW - Main engine)
├── rules.py (NEW - Detection rules)
├── models.py (NEW - Alert models)
├── redis_client.py (NEW - Pub/Sub)
├── database.py (NEW - Alert storage)
└── tests/ (NEW)
    └── test_engine.py
```

**Core Logic:**
```python
# Pseudo-code
async def alert_engine_main():
    redis_client = get_redis()
    db_pool = get_db_pool()
    
    # Subscribe to alerts stream
    async for message in redis_client.xread('alerts_stream'):
        alert_data = parse_alert(message)
        
        # 1. Apply rules
        severity, incident_type = apply_rules(alert_data)
        
        # 2. Store in DB
        async with db_pool.acquire() as conn:
            await conn.execute(
                'INSERT INTO alerts (type, severity, data)',
                (incident_type, severity, alert_data)
            )
        
        # 3. Broadcast (all connected WebSocket clients get it <100ms)
        await redis_client.publish(
            'alerts_channel',
            {
                'type': incident_type,
                'severity': severity,
                'location': alert_data['location'],
                'timestamp': datetime.now()
            }
        )
```

**Alert Types:**
```
1. CONGESTION (severity: LOW)
   - Trigger: Speed < 20 km/h for 5+ minutes
   
2. INCIDENT (severity: MEDIUM)
   - Trigger: Vehicle stopped > 10 minutes
   
3. ACCIDENT (severity: HIGH)
   - Trigger: Sudden speed drop, impact detected
   
4. SYSTEM_ERROR (severity: CRITICAL)
   - Trigger: Data quality issues, duplicate GPS
```

**Deployment:**
- Docker container
- Environment: Production
- Memory: 256 MB
- CPU: 0.5 core
- Auto-restart on failure

---

## 3. COMMUNICATION PATTERNS

### Pattern 1: IoT Node → WebSocket API → Redis Streams

```
WebSocket Flow (100ms):
100 IoT Nodes
    ↓ (WebSocket connection)
Receive data
    ↓ (Validate & enrich)
Queue to Redis Streams
    ↓ (Fire & forget)
Send ACK to IoT node
    ↓ (Instant response)
[Total: 50-100ms latency]
```

### Pattern 2: Redis Streams → Worker Pool → TimescaleDB

```
Processing Flow (50-500ms per batch):
Redis Streams (100-1000 messages)
    ↓ (Consumer group reads)
Worker Pool (4-8 instances)
    ↓ (Batch transform)
Connection Pool (reused connections)
    ↓ (SQL prepared statements)
TimescaleDB (batch insert)
    ↓ (Compression automatic)
[Total: 50-500ms for 100 messages]
```

### Pattern 3: Redis Pub/Sub → WebSocket API → Mobile Clients

```
Real-Time Alert Flow (<100ms):
Alert triggered
    ↓ (Detect in Worker/Engine)
Alert Engine publishes to Redis Pub/Sub
    ↓ (Sub-100ms distribution)
WebSocket API receives and broadcasts
    ↓ (Connected clients get update)
Mobile app displays notification
    ↓ (User sees it in <100ms from source)
[Total: <100ms end-to-end]
```

### Pattern 4: Frontend → HTTP API → Redis Cache → TimescaleDB

```
Query Flow (10-100ms):
HTTP request from frontend
    ↓ (Generate cache key)
Check Redis cache
    ↓ (if hit: return in 10-20ms)
    ↓ (if miss: query DB)
TimescaleDB returns aggregates
    ↓ (Only 24 points, not 86400)
Store in Redis (1-hour TTL)
    ↓ (Return to client)
[Cache Hit: 10-20ms | Cache Miss: 50-100ms]
```

---

## 4. DATA FLOW

### Incoming Data (100 nodes → TimescaleDB)

```
IoT Node sends:
{
  "node_id": "CAM-001",
  "location": {"lat": 48.8566, "lng": 2.3522},
  "speed": 35.5,
  "timestamp": "2026-04-30T14:23:45Z",
  "vehicle_count": 42,
  "congestion_level": "MEDIUM"
}

↓ WebSocket validates & enriches:
{
  "node_id": "CAM-001",
  "location": {"lat": 48.8566, "lng": 2.3522},
  "speed": 35.5,
  "timestamp": "2026-04-30T14:23:45Z",
  "vehicle_count": 42,
  "congestion_level": "MEDIUM",
  "received_at": "2026-04-30T14:23:45.123Z",  # Server time
  "server": "192.168.1.100"
}

↓ Queued to Redis Streams (traffic_stream)

↓ Worker Pool reads & transforms:
INSERT INTO traffic_data (
  node_id, lat, lng, speed, vehicle_count,
  congestion_level, recorded_at
) VALUES (...)

↓ TimescaleDB stores (automatically compressed)

↓ Continuous Aggregate updates hourly:
SELECT node_id, 
       avg(speed), 
       max(vehicle_count),
       time_bucket('1 hour', recorded_at) as hour
FROM traffic_data
GROUP BY node_id, hour
```

### Outgoing Data (TimescaleDB → Frontend)

```
Frontend requests: /api/aggregates?hours=24

↓ HTTP API queries (only hourly data):
SELECT node_id, 
       time_bucket('1 hour', recorded_at) as hour,
       avg_speed, 
       max_vehicle_count
FROM traffic_aggregates
WHERE recorded_at > NOW() - INTERVAL '24 hours'
ORDER BY hour DESC

↓ Returns 24 points per node (not 86,400)
{
  "data": [
    {"hour": "2026-04-30T13:00:00Z", "avg_speed": 35.2, "vehicles": 42},
    {"hour": "2026-04-30T12:00:00Z", "avg_speed": 28.5, "vehicles": 58},
    ...24 more points...
  ]
}

↓ Frontend/Mobile applies spline interpolation
   (Smooth curves from 24 points)

↓ User sees smooth chart (99.97% less data)
```

---

## 5. DATABASE SCHEMA

### TimescaleDB Tables

```sql
-- Raw data (hypertable, compressed after 7 days)
CREATE TABLE traffic_data (
  id BIGSERIAL,
  node_id TEXT NOT NULL,
  lat FLOAT8 NOT NULL,
  lng FLOAT8 NOT NULL,
  speed FLOAT4 NOT NULL,
  vehicle_count INT,
  congestion_level TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  server TEXT,
  PRIMARY KEY (recorded_at, node_id, id)
) PARTITION BY RANGE (recorded_at);

SELECT create_hypertable('traffic_data', 'recorded_at', 
  if_not_exists => TRUE);

-- Enable compression (10:1 ratio expected)
ALTER TABLE traffic_data SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'node_id',
  timescaledb.compress_orderby = 'recorded_at DESC'
);

SELECT add_compression_policy('traffic_data', INTERVAL '7 days');

-- Continuous aggregate (hourly)
CREATE MATERIALIZED VIEW traffic_aggregates
WITH (timescaledb.continuous) AS
SELECT node_id,
       time_bucket(INTERVAL '1 hour', recorded_at) as hour,
       AVG(speed) as avg_speed,
       MAX(speed) as max_speed,
       MIN(speed) as min_speed,
       MAX(vehicle_count) as peak_vehicles,
       AVG(vehicle_count) as avg_vehicles,
       COUNT(*) as measurements
FROM traffic_data
GROUP BY node_id, time_bucket(INTERVAL '1 hour', recorded_at);

-- Refresh policy (every 5 minutes)
SELECT add_continuous_aggregate_policy('traffic_aggregates',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes');

-- Retention policy (keep raw for 24h, delete after 30d)
SELECT add_retention_policy('traffic_data', INTERVAL '30 days');

-- Alerts table
CREATE TABLE alerts (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT,
  location POINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

SELECT create_hypertable('alerts', 'created_at', 
  if_not_exists => TRUE);

-- Indexes for performance
CREATE INDEX ON traffic_data (node_id, recorded_at DESC);
CREATE INDEX ON alerts (severity, created_at DESC);
```

---

## 6. DEPLOYMENT MODEL

### Docker Compose (Local Development)

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  postgresql:
    image: timescale/timescaledb:latest-pg14
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: traffic_admin
      POSTGRES_DB: trafficcam
    volumes:
      - postgres_data:/var/lib/postgresql/data

  websocket_api:
    build:
      context: .
      dockerfile: backend/websocket/Dockerfile
    ports:
      - "8765:8765"
    environment:
      REDIS_URL: redis://redis:6379
      DB_URL: postgresql://user:pass@postgresql:5432/trafficcam
    depends_on:
      - redis
      - postgresql

  workers:
    build:
      context: .
      dockerfile: backend/workers/Dockerfile
    environment:
      REDIS_URL: redis://redis:6379
      DB_URL: postgresql://user:pass@postgresql:5432/trafficcam
      WORKER_INSTANCES: 4
    depends_on:
      - redis
      - postgresql
    deploy:
      replicas: 4

  http_api:
    build:
      context: .
      dockerfile: backend/http/Dockerfile
    ports:
      - "5000:5000"
    environment:
      REDIS_URL: redis://redis:6379
      DB_URL: postgresql://user:pass@postgresql:5432/trafficcam
    depends_on:
      - redis
      - postgresql

  alert_engine:
    build:
      context: .
      dockerfile: backend/alerts/Dockerfile
    environment:
      REDIS_URL: redis://redis:6379
      DB_URL: postgresql://user:pass@postgresql:5432/trafficcam
    depends_on:
      - redis
      - postgresql

volumes:
  redis_data:
  postgres_data:
```

### Production Deployment (Kubernetes-ready)

```yaml
# websocket-api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: websocket-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: websocket-api
  template:
    metadata:
      labels:
        app: websocket-api
    spec:
      containers:
      - name: websocket-api
        image: trafficcam/websocket-api:latest
        ports:
        - containerPort: 8765
        env:
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: redis_url
        - name: DB_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: db_url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8765
          initialDelaySeconds: 10
          periodSeconds: 10
```

---

## 7. SCALING STRATEGY

### Horizontal Scaling

```
Current: 100 IoT Nodes
├─ WebSocket API: 1 instance
├─ Worker Pool: 4 instances
├─ HTTP API: 2 instances
├─ Alert Engine: 1 instance

Scale to: 1000 IoT Nodes (10x)
├─ WebSocket API: 2-3 instances (behind load balancer)
├─ Worker Pool: 10-16 instances (auto-scale based on queue depth)
├─ HTTP API: 4-6 instances (behind load balancer)
├─ Alert Engine: 2 instances (redundant)

No code changes needed!
Only modify deployment replicas.
```

### Vertical Scaling

```
If single node bottleneck:
├─ Redis: Use cluster mode (3-6 nodes)
├─ PostgreSQL: Add replica servers, use read replicas for queries
├─ Worker Pool: Use async optimizations, batch larger operations
```

---

## 8. ERROR HANDLING & RESILIENCE

### Redis Streams Consumer Group Advantages

```
Guarantee: Every message processed exactly once

If Worker crashes:
1. Unacknowledged messages stay in pending list
2. Another worker picks up the message
3. Message marked ACK only after DB insert succeeds
4. No data loss, no duplicates

Dead-Letter Queue:
After 3 retries, move to dlq_stream
Manual intervention required
```

### Connection Failures

```
WebSocket Disconnection:
├─ IoT sends heartbeat every 10 seconds
├─ If no ACK for 30 seconds, node reconnects
├─ WebSocket server cleans up resources
└─ No memory leak

Database Connection Failure:
├─ Connection pool handles reconnection
├─ Failed message stays in Redis queue
├─ Automatic retry after 5 seconds
└─ Alerts to monitoring system

Redis Failure:
├─ Data in-flight cached locally (on IoT device)
├─ Reconnect when Redis available
└─ Batch send on reconnect
```

---

## 9. MONITORING & OBSERVABILITY

### Key Metrics to Track

```
WebSocket API:
├─ Active connections (target: 100)
├─ Messages/sec (target: 500-1000)
├─ CPU usage (target: <30%)
├─ Memory usage (target: <300MB)

Worker Pool:
├─ Queue depth (target: <1000 messages)
├─ Processing time/message (target: 5-10ms)
├─ CPU usage (target: 40-60%)
├─ Database connections active (target: 2-4 per worker)

HTTP API:
├─ Requests/sec (target: 100+)
├─ Response time p99 (target: <100ms)
├─ Cache hit rate (target: >95%)
├─ Active connections (target: 20-50)

Alert Engine:
├─ Detection latency (target: <100ms)
├─ Alerts/minute (target: varies)
├─ CPU usage (target: <10%)

Redis:
├─ Memory usage (target: <1GB)
├─ Commands/sec (target: 5000+)
├─ Evictions (target: 0)

TimescaleDB:
├─ Query response time (target: <50ms)
├─ Compression ratio (target: 10:1)
├─ Disk usage (target: 18.9GB/year)
├─ Active connections (target: <20)
```

### Alerting Rules

```
CRITICAL:
├─ WebSocket API down (check /health every 10s)
├─ Worker pool queue depth > 10,000
├─ Database connections exhausted
├─ Redis memory > 90%

HIGH:
├─ Processing latency > 500ms
├─ Cache hit rate < 80%
├─ Alert detection latency > 500ms

MEDIUM:
├─ CPU usage > 70%
├─ Memory usage > 70%
├─ Response time p99 > 200ms
```

---

## 10. DEVELOPMENT WORKFLOW

### Phase 1: Foundation (Week 1-2)

**Sprint 1.1: Infrastructure Setup**
- Create Redis Streams + consumer groups
- Create TimescaleDB schema
- Create connection pool setup
- Create health check endpoints
- **Deliverable:** All services respond to /health

**Sprint 1.2: Service Implementation**
- WebSocket API (receive, queue, ACK)
- Worker Pool (read, transform, write)
- HTTP API (query, cache)
- Alert Engine (detect, publish)
- **Deliverable:** End-to-end data flow works

### Phase 2: Testing (Week 2-3)

**Sprint 2.1: Unit Tests**
- Each service has 80%+ code coverage
- Mock Redis and database
- Test error scenarios

**Sprint 2.2: Integration Tests**
- Full data flow: IoT → Redis → DB → Frontend
- Simulate 100 concurrent nodes
- Verify no message loss

### Phase 3: Production Ready (Week 3-4)

**Sprint 3.1: Performance Testing**
- Load test with 500 msgs/sec
- Verify <100ms latency
- Check compression ratio

**Sprint 3.2: Deployment**
- Docker build optimization
- Documentation
- Runbook for operations

---

## 11. CONFIGURATION MANAGEMENT

### Environment Variables

```bash
# WebSocket API
WEBSOCKET_PORT=8765
WEBSOCKET_WORKERS=1
REDIS_URL=redis://redis:6379
DB_URL=postgresql://user:pass@localhost/trafficcam
LOG_LEVEL=INFO

# Worker Pool
WORKER_INSTANCES=4
BATCH_SIZE=100
BATCH_TIMEOUT=5000  # milliseconds
RETRY_ATTEMPTS=3
REDIS_URL=redis://redis:6379
DB_URL=postgresql://user:pass@localhost/trafficcam

# HTTP API
HTTP_PORT=5000
HTTP_WORKERS=2
CACHE_TTL=3600  # seconds
REDIS_URL=redis://redis:6379
DB_URL=postgresql://user:pass@localhost/trafficcam
CORS_ORIGINS=["http://localhost:3000", "https://app.com"]

# Alert Engine
REDIS_URL=redis://redis:6379
DB_URL=postgresql://user:pass@localhost/trafficcam
ALERT_RULES_FILE=/config/alert_rules.yaml
```

### Alert Rules (alert_rules.yaml)

```yaml
rules:
  congestion:
    condition: "speed < 20 and duration > 300"  # 5 minutes
    severity: "LOW"
    message: "Traffic congestion detected"
  
  incident:
    condition: "speed < 5 and duration > 600"   # 10 minutes
    severity: "MEDIUM"
    message: "Possible traffic incident"
  
  accident:
    condition: "speed_drop > 50 in 10 seconds"
    severity: "HIGH"
    message: "Possible accident detected"
```

---

## 12. DEVELOPMENT ROADMAP

### Week 1 (Foundation)
- Day 1-2: Redis Streams + TimescaleDB setup
- Day 3: WebSocket API skeleton
- Day 4: Worker Pool skeleton
- Day 5: HTTP API skeleton

### Week 2 (Integration)
- Day 1-2: WebSocket → Redis data flow
- Day 3-4: Redis → Worker → DB flow
- Day 5: Alert Engine integration

### Week 3 (Testing & Performance)
- Day 1-2: Unit & integration tests
- Day 3-4: Load testing (500 msgs/sec)
- Day 5: Bug fixes & optimization

### Week 4 (Production)
- Day 1-2: Docker containerization
- Day 3-4: Documentation & runbooks
- Day 5: Deployment & final testing

---

## 13. SUCCESS CRITERIA

After 2 months (4 weeks) with 2 developers:

✅ **Functionality:**
- WebSocket API receives data from 100 nodes
- Worker Pool processes messages <5ms per message
- HTTP API returns queries in <100ms (cached)
- Alert Engine detects incidents <100ms
- No data loss (exactly-once guarantee)

✅ **Performance:**
- Handle 1000+ concurrent users
- Process 500K+ messages/sec capacity
- Cache hit rate >95%
- Database compression ratio >10:1

✅ **Reliability:**
- 99.9% uptime
- No memory leaks
- Automatic failover for failed components
- Clear error messages in logs

✅ **Operability:**
- Health checks on all services
- Monitoring dashboard (Prometheus + Grafana)
- Clear documentation
- Runbook for common failures

---

## 14. NEXT STEPS

### Immediate (This Week)
1. ✅ Review architecture with team
2. ✅ Set up Docker development environment
3. ✅ Create git branches for each service
4. ✅ Begin infrastructure setup

### This Month
1. Complete foundation services
2. Implement integration tests
3. Performance testing

### Mobile App (Parallel Weeks 6-8)
1. React Native project setup
2. Real-time WebSocket integration
3. Map visualization with aggregated data

---

**Ready to start? Create git branches and assign tasks to each developer!**

