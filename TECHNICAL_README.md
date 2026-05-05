# TrafficCAM Dashboard - Technical Documentation

## Project Overview

**TrafficCAM Dashboard** is a real-time traffic supervision and monitoring platform that displays live traffic data including vehicle density, speed, alerts, and camera feeds on an interactive map. The system integrates multiple data sources and provides comprehensive traffic analysis and visualization tools.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Browser)                        │
│  HTML5 │ Bootstrap │ Leaflet.js │ Chart.js │ WebSocket      │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
┌───▼────────────┐   ┌────────▼──────────┐
│  Flask HTTP    │   │  WebSocket Server │
│  (Port 5000)   │   │  (Port 8765)      │
└───┬────────────┘   └────────┬──────────┘
    │                         │
    └────────────┬────────────┘
                 │
          ┌──────▼───────┐
          │   MySQL DB   │
          │ traffic_     │
          │ control_db   │
          └──────────────┘
```

## Technology Stack

### Frontend
- **HTML5** - Dashboard pages (dashboard, tables, notifications, statistics)
- **CSS/SCSS** - Material Dashboard theme with custom styling
- **JavaScript Libraries:**
  - **Leaflet.js** - Interactive mapping and geolocation
  - **Chart.js** - Real-time traffic statistics and graphs
  - **Bootstrap** - Responsive UI framework
  - **WebSocket API** - Real-time data streaming

### Backend
- **Python 3.x**
  - **Flask** - HTTP REST API server
  - **Flask-CORS** - Cross-origin resource sharing
  - **websockets** - WebSocket server for real-time data
  - **aiomysql** - Async MySQL connection pooling
  - **mysql-connector-python** - Synchronous database driver

### Database
- **MySQL** - `traffic_control_db`

## Project Structure

```
trafficam_dashboard/
├── backend/
│   ├── http/
│   │   └── serverAppV2.py       # Flask HTTP API server
│   └── websocket/
│       └── app_v3.py            # WebSocket real-time server
├── frontend/
│   ├── pages/
│   │   ├── dashboard.html       # Main dashboard with map
│   │   ├── tables.html          # Intersection management view
│   │   ├── notifications.html   # Alert notifications
│   │   └── statistiques.html    # Traffic statistics
│   ├── js/
│   │   ├── my_scripts/
│   │   │   ├── map_v3.js        # Map and real-time data handling
│   │   │   ├── tables_script.js # Table data management
│   │   │   ├── notifications.js # Notification system
│   │   │   └── statistics.js    # Statistics visualization
│   │   ├── core/                # Bootstrap & Popper libraries
│   │   └── plugins/             # Chart.js, scrollbar, etc.
│   ├── css/
│   │   ├── material-dashboard.css    # Main theme
│   │   └── my_css/style_my_style.css # Custom styles
│   └── img/                     # Images and assets
├── start_dashboard.py           # Entry point script
├── traffic_supervision_db.sql   # Database schema
├── README.markdown              # Original French documentation
└── TECHNICAL_README.md          # This file
```

## Core Components

### 1. Frontend Pages

#### `dashboard.html`
- **Purpose:** Main real-time traffic monitoring interface
- **Features:**
  - Interactive Leaflet map showing intersections
  - Real-time vehicle density and speed data
  - Live camera feeds from traffic intersections
  - Chart.js graphs for traffic metrics
  - WebSocket connection for live updates

#### `tables.html`
- **Purpose:** Intersection and infrastructure management
- **Features:**
  - Filterable table of all intersections
  - Filter by governorate (region)
  - Edit camera URLs
  - Delete/manage nodes
  - Bulk operations support

#### `notifications.html`
- **Purpose:** Traffic alert and incident management
- **Features:**
  - Real-time alert notifications
  - Filter by governorate or node ID
  - Display alert content, timestamp, and location
  - Alert history tracking

#### `statistiques.html`
- **Purpose:** Traffic analytics and trends
- **Features:**
  - Congestion statistics by hour and zone
  - Heat maps of congested areas
  - Historical data visualization
  - Comparative traffic analysis

### 2. Backend Services

#### `serverAppV2.py` - Flask HTTP API Server
**Port:** 5000

**Key Endpoints:**
- `GET /get_intersections` - Fetch all intersection locations and node data
- `GET /poll_new_nodes` - Long-polling endpoint for new node detection
- `GET /get_notifications` - Retrieve filtered notifications
- `POST /delete_node` - Remove a node from system
- `POST /update_camera_url` - Update camera feed URL
- Additional routes for data retrieval and management

**Features:**
- RESTful API architecture
- CORS-enabled for cross-origin requests
- Database connection pooling with session management
- Query caching disabled for fresh data
- Comprehensive error logging

#### `app_v3.py` - WebSocket Real-Time Server
**Port:** 8765

**Functions:**
- Receives real-time vehicle and traffic data from IoT sources
- Processes notification events
- Manages configuration updates
- Broadcasts data to connected frontend clients
- Async database operations via aiomysql
- Client connection tracking and lifecycle management

**Data Handled:**
- Vehicle count and density metrics
- Speed statistics
- Capacity monitoring
- Governorate and location-based grouping
- System configuration changes

### 3. Frontend JavaScript Modules

#### `map_v3.js`
- Initializes Leaflet map with traffic intersections
- Manages WebSocket/polling connection to real-time server
- Updates map markers based on live data
- Handles camera feed integration
- Manages Chart.js instances for live graphs
- Dynamic IP address configuration

#### `tables_script.js`
- Loads and displays intersection data in HTML table
- Implements filtering by governorate
- Handles inline editing (camera URLs)
- Node deletion with confirmation
- Server communication via HTTP

#### `notifications.js`
- Fetches alerts and notifications from backend
- Implements filtering system
- Displays notification timeline
- Real-time notification updates via WebSocket

#### `statistics.js`
- Chart.js graph initialization and updates
- Processes traffic statistics data
- Manages heatmaps for congestion zones
- Handles time-based filtering and comparisons

## Database Schema

**Database Name:** `traffic_control_db`

**Key Tables:**
- **intersections** - Traffic intersection metadata (lat/lon, address, governorate, capacity)
- **nodes** - Individual monitoring nodes within intersections
- **cams** - Camera configuration and status
- **notifications** - Alert and incident records
- **history** - Historical traffic data archive

## Setup & Installation

### Prerequisites
- Python 3.7+
- MySQL Server 5.7+
- Modern web browser (Chrome, Firefox, Edge)
- npm (optional, for SCSS compilation)

### Installation Steps

1. **Database Setup**
   ```bash
   mysql -u root -p < traffic_supervision_db.sql
   ```

2. **Python Dependencies**
   ```bash
   pip install flask flask-cors mysql-connector-python websockets aiomysql
   ```

3. **Configuration**
   - Edit `serverAppV2.py` line 14: Update MySQL credentials if needed
   - Edit `app_v3.py`: Configure database connection parameters
   - Ensure MySQL user has appropriate permissions on `traffic_control_db`

4. **Start Dashboard**
   ```bash
   python start_dashboard.py
   ```
   - Script automatically detects local IP address
   - Updates frontend JavaScript with correct server IP
   - Launches Flask and WebSocket servers
   - Opens dashboard in default browser on `http://localhost:5000`

## Network Communication Flow

### Data Flow: Real-Time Updates
1. **IoT Device/Source** → WebSocket Server (port 8765)
   - Sends vehicle density, speed, alerts
2. **WebSocket Server** → MySQL Database
   - Persists real-time data
3. **Frontend WebSocket Client** ← WebSocket Server
   - Receives broadcast updates
4. **Frontend** → **Leaflet Map & Chart.js**
   - Visualizes data

### Data Flow: On-Demand Queries
1. **Frontend** → Flask HTTP Server (port 5000)
   - Requests intersections, notifications, statistics
2. **Flask Server** → MySQL Database
   - Queries data with caching disabled
3. **Flask Server** → **Frontend (JSON response)**
   - Returns data for UI rendering

## Key Features

✅ **Real-Time Monitoring**
- Live traffic density and speed metrics
- WebSocket-based data streaming
- Sub-second update latency

✅ **Geographic Integration**
- Interactive Leaflet map
- GPS-based intersection mapping
- Governorate-level filtering

✅ **Camera Integration**
- Multiple camera feed support
- Live video streaming capability
- URL-based camera configuration

✅ **Analytics & Reporting**
- Historical traffic statistics
- Congestion pattern analysis
- Time-based trend visualization
- Heatmap generation

✅ **Alert Management**
- Real-time notifications
- Incident tracking
- Location-based alert filtering
- Notification history

✅ **Responsive Design**
- Mobile-friendly Bootstrap layout
- Cross-browser compatibility
- Adaptive UI for various screen sizes

## Performance Considerations

- **Database Optimization:**
  - Query caching explicitly disabled for live data freshness
  - Connection pooling for concurrent requests
  - Async database operations via aiomysql for non-blocking I/O

- **Frontend Optimization:**
  - Minified CSS/JS libraries (material-dashboard.min.js)
  - Smooth scrollbar for UI performance
  - Chart.js with plugin extensions for efficient rendering

- **WebSocket Optimization:**
  - Persistent connections reduce overhead
  - Async processing prevents blocking
  - Client connection management

## Development Workflow

### Local Development
1. Start Flask server: `python backend/http/serverAppV2.py`
2. Start WebSocket server: `python backend/websocket/app_v3.py`
3. Serve frontend from any HTTP server or direct file access
4. Open `frontend/pages/dashboard.html` in browser

### SCSS Compilation (Optional)
```bash
# If modifying styles, compile SCSS to CSS
sass frontend/scss/material-dashboard.scss frontend/css/material-dashboard.css
```

### Testing & Debugging
- Flask debug mode: Set `app.run(debug=True)` in serverAppV2.py
- Browser console for frontend errors
- MySQL logging for database issues
- WebSocket frame inspection using browser DevTools

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MySQL connection failed | Verify MySQL is running, check credentials in serverAppV2.py and app_v3.py |
| WebSocket connection timeout | Check firewall rules for port 8765, verify app_v3.py is running |
| Map not loading | Ensure Leaflet.js is accessible, check browser console for errors |
| Real-time data not updating | Verify WebSocket connection in browser DevTools, check WebSocket server logs |
| CORS errors | Verify Flask-CORS is installed and enabled in serverAppV2.py |

## API Reference

### Flask HTTP API (Port 5000)

**GET /get_intersections**
```json
Response: [
  {
    "latitude": 36.806389,
    "longitude": 10.177222,
    "node_id": 1
  }
]
```

**GET /poll_new_nodes?last_node_id=0**
- Long-polling endpoint for new node detection

**GET /get_notifications**
- Retrieve alert notifications with optional filters

### WebSocket API (Port 8765)

**Incoming Message Format:**
```json
{
  "type": "vehicle_data",
  "data": {
    "node_id": 1,
    "density": 45,
    "speed": 35.2,
    "timestamp": "2026-04-28T14:30:00Z"
  }
}
```

## Future Enhancements

- Real-time predictive traffic modeling
- Machine learning for congestion prediction
- Mobile app (React Native/Flutter)
- Advanced incident detection algorithms
- Integration with traffic light control systems
- Multi-language support (currently French/English)
- Role-based access control
- Traffic incident reporting system

## Dependencies Summary

| Package | Version | Purpose |
|---------|---------|---------|
| Flask | 2.x+ | Web framework |
| Flask-CORS | 3.x+ | Cross-origin support |
| mysql-connector-python | 8.x+ | Database driver |
| websockets | 10.x+ | WebSocket protocol |
| aiomysql | 0.1.x+ | Async MySQL |
| Leaflet.js | 1.x+ | Mapping library |
| Chart.js | 3.x+ | Charting library |
| Bootstrap | 4.x+ | UI framework |

## Support & Maintenance

For issues, bugs, or feature requests:
1. Check browser console for frontend errors
2. Review server logs for backend issues
3. Verify database connectivity and schema
4. Test WebSocket connection status
5. Check network firewall rules

## License & Credits

Project Name: **TrafficCAM Dashboard**
Type: Real-Time Traffic Supervision System
Built with: Flask, WebSocket, MySQL, Leaflet, Chart.js

---

**Last Updated:** April 28, 2026
**Documentation Version:** 1.0
