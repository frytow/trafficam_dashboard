from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
import psycopg2
import psycopg2.extras
import time
import logging
import websockets
import json
import asyncio

app = Flask(__name__)
CORS(app)

# Static file serving setup
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend')

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_db_connection():
    """Create a new database connection."""
    try:
        database_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
        if database_url:
            conn = psycopg2.connect(dsn=database_url, sslmode="require")
        else:
            conn = psycopg2.connect(
                host=os.getenv("PGHOST", "localhost"),
                user=os.getenv("PGUSER", "postgres"),
                password=os.getenv("PGPASSWORD", "admin"),
                dbname=os.getenv("PGDATABASE", "trafficam_db"),
                port=int(os.getenv("PGPORT", 5432))
            )
        conn.autocommit = True
        logger.debug("New database connection created: %s", conn)
        return conn
    except psycopg2.Error as e:
        logger.error("Error creating database connection: %s", e)
        raise

@app.route('/get_intersections', methods=['GET'])
def get_intersections():
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Query to check total nodes
        cursor.execute("SELECT COUNT(*) as node_count FROM nodes")
        node_count = cursor.fetchone()['node_count']
        logger.debug("Total nodes in database: %d", node_count)
        
        # Fetch intersections
        cursor.execute("""
            SELECT latitude, longitude, nodes.id as node_id 
            FROM intersections 
            JOIN nodes ON nodes.intersection_id = intersections.id
        """)
        intersections = cursor.fetchall()
        
        logger.info("Fetched %d intersections: %s", len(intersections), intersections)
        
        cursor.close()
        db.close()
        return jsonify(intersections)
    except psycopg2.Error as e:
        logger.error("Error fetching intersections: %s", e)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error("Unexpected error in get_intersections: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route('/poll_new_nodes', methods=['GET'])
def poll_new_nodes():
    try:
        last_node_id = request.args.get('last_node_id', type=int, default=0)
        timeout = 30
        poll_interval = 2
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            db = get_db_connection()
            cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            
            # Diagnostic query
            cursor.execute("SELECT COUNT(*) as node_count FROM nodes")
            node_count = cursor.fetchone()['node_count']
            logger.debug("Total nodes during poll: %d", node_count)
                        
            # Check for new nodes
            cursor.execute("""
                SELECT latitude, longitude, nodes.id as node_id 
                FROM intersections 
                JOIN nodes ON nodes.intersection_id = intersections.id
                WHERE nodes.id > %s
            """, (last_node_id,))
            new_intersections = cursor.fetchall()
            
            cursor.close()
            db.close()
            
            if new_intersections:
                logger.info("Found %d new intersections: %s", len(new_intersections), new_intersections)
                return jsonify(new_intersections)
            
            time.sleep(poll_interval)
        
        logger.debug("No new nodes found after timeout")
        return jsonify([])
    except psycopg2.Error as e:
        logger.error("Error polling new nodes: %s", e)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error("Unexpected error in poll_new_nodes: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route('/get_intersection_info', methods=['GET'])
def get_intersection_info():
    lat = float(request.args.get('lat'))
    lng = float(request.args.get('lng'))
    logger.debug("Fetching intersection info for lat=%s, lng=%s", lat, lng)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        query = """
            SELECT 
                intersections.address,
                intersections.capacity,
                nodes.cams,
                COALESCE(SUM(cams.lanes), 0) AS total_lanes
            FROM intersections
            JOIN nodes ON intersections.id = nodes.intersection_id
            LEFT JOIN cams ON nodes.id = cams.node_id
            WHERE ABS(intersections.latitude - %s) < 0.0001 AND ABS(intersections.longitude - %s) < 0.0001
            GROUP BY intersections.address, intersections.capacity, nodes.cams
        """
        cursor.execute(query, (lat, lng))
        intersection = cursor.fetchone()
        cursor.close()
        db.close()
        logger.debug("Intersection info: %s", intersection)
        if intersection:
            return jsonify(intersection)
        else:
            return jsonify({"error": "Intersection not found"}), 404
    except psycopg2.Error as e:
        logger.error("Error fetching intersection info: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route('/get_address', methods=['GET'])
def get_address():
    node_id = request.args.get('node_id')
    logger.debug("Fetching address for node_id=%s", node_id)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        query = """
            SELECT address 
            FROM intersections, nodes 
            WHERE nodes.intersection_id = intersections.id AND nodes.id = %s
        """
        cursor.execute(query, (node_id,))
        address = cursor.fetchone()
        cursor.close()
        db.close()
        logger.debug("Address: %s", address)
        if address:
            return jsonify(address)
        else:
            return jsonify({"error": "Intersection not found"}), 404
    except psycopg2.Error as e:
        logger.error("Error fetching address: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route('/api/intersections/filter', methods=['GET'])
def filter_intersections_by_governorate():
    governorate = request.args.get('governorate')
    logger.debug("Filtering intersections by governorate=%s", governorate)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        if governorate:
            query = """
                SELECT 
                    intersections.address, 
                    intersections.latitude, 
                    intersections.longitude, 
                    intersections.capacity, 
                    nodes.cams, 
                    COALESCE(SUM(cams.lanes), 0) AS total_lanes
                FROM intersections
                JOIN nodes ON nodes.intersection_id = intersections.id
                LEFT JOIN cams ON nodes.id = cams.node_id
                WHERE intersections.governorate = %s
                GROUP BY intersections.id, intersections.address, intersections.latitude, intersections.longitude, intersections.capacity, nodes.cams
            """
            cursor.execute(query, (governorate,))
        else:
            query = """
                SELECT 
                    intersections.address, 
                    intersections.latitude, 
                    intersections.longitude, 
                    intersections.capacity, 
                    nodes.cams, 
                    COALESCE(SUM(cams.lanes), 0) AS total_lanes
                FROM intersections
                JOIN nodes ON nodes.intersection_id = intersections.id
                LEFT JOIN cams ON nodes.id = cams.node_id
                GROUP BY intersections.id, intersections.address, intersections.latitude, intersections.longitude, intersections.capacity, nodes.cams
            """
            cursor.execute(query)
        data = cursor.fetchall()
        cursor.close()
        db.close()
        logger.debug("Filtered intersections: %s", data)
        return jsonify({"success": True, "data": data})
    except psycopg2.Error as e:
        logger.error("Error filtering intersections: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/intersections/delete', methods=['DELETE'])
def delete_intersection():
    try:
        data = request.get_json()
        lat = float(data.get('latitude'))
        lng = float(data.get('longitude'))
        logger.debug("Deleting intersection at lat=%s, lng=%s", lat, lng)
        
        db = get_db_connection()
        cursor = db.cursor()
        
        # Find the intersection ID
        cursor.execute("""
            SELECT id FROM intersections 
            WHERE latitude = %s AND longitude = %s
        """, (lat, lng))
        intersection = cursor.fetchone()
        
        if not intersection:
            cursor.close()
            db.close()
            logger.debug("Intersection not found for deletion")
            return jsonify({"success": False, "error": "Intersection not found"}), 404
        
        intersection_id = intersection[0]
        
        # Delete the intersection (cascading)
        cursor.execute("DELETE FROM intersections WHERE id = %s", (intersection_id,))
        
        cursor.close()
        db.close()
        logger.info("Successfully deleted intersection with id=%s", intersection_id)
        return jsonify({"success": True, "message": "Intersection deleted successfully"})
    except psycopg2.Error as e:
        logger.error("Error deleting intersection: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        logger.error("Unexpected error in delete_intersection: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/intersections/update', methods=['PUT'])
async def update_intersection():
    logger.debug("Received update request: %s", request.get_json())
    try:
        data = request.get_json()
        if not data:
            logger.error("No JSON data provided in update request")
            return jsonify({"success": False, "error": "No JSON data provided"}), 400

        original_lat = float(data.get('original_latitude'))
        original_lng = float(data.get('original_longitude'))
        lat = float(data.get('latitude'))
        lng = float(data.get('longitude'))
        address = data.get('address')
        capacity = int(data.get('capacity'))
        logger.info("Updating intersection from lat=%s, lng=%s to lat=%s, lng=%s with address=%s, capacity=%s",
                    original_lat, original_lng, lat, lng, address, capacity)

        if not address or capacity < 0 or abs(lat) > 90 or abs(lng) > 180:
            logger.error("Invalid input: address=%s, capacity=%s, lat=%s, lng=%s", address, capacity, lat, lng)
            return jsonify({"success": False, "error": "Invalid input data"}), 400

        db = get_db_connection()
        cursor = db.cursor()

        # Find the intersection ID
        cursor.execute("""
            SELECT id FROM intersections 
            WHERE ABS(latitude - %s) < 0.0001 AND ABS(longitude - %s) < 0.0001
        """, (original_lat, original_lng))
        intersection = cursor.fetchone()
        logger.debug("Intersection query result: %s", intersection)

        if not intersection:
            cursor.close()
            db.close()
            logger.error("Intersection not found for lat=%s, lng=%s", original_lat, original_lng)
            return jsonify({"success": False, "error": "Intersection not found"}), 404

        intersection_id = intersection[0]

        # Update the intersection
        cursor.execute("""
            UPDATE intersections 
            SET address = %s, capacity = %s, latitude = %s, longitude = %s
            WHERE id = %s
        """, (address, capacity, lat, lng, intersection_id))
        logger.debug("Intersection updated in database: id=%s", intersection_id)

        # Find associated node_id
        cursor.execute("SELECT id FROM nodes WHERE intersection_id = %s", (intersection_id,))
        node = cursor.fetchone()
        node_id = node[0] if node else None
        logger.debug("Node query result: node_id=%s", node_id)

        cursor.close()
        db.close()

        if node_id:
            # Notify WebSocket server of the update
            async def notify_websocket_async():
                try:
                    async with websockets.connect("ws://192.168.1.17:8765/ws") as ws:  
                        update_message = {
                            "type": "node_update",
                            "node_id": str(node_id),
                            "latitude": float(lat),
                            "longitude": float(lng)
                        }
                        await ws.send(json.dumps(update_message))
                        logger.info("Successfully sent async node_update message: %s", update_message)
                except Exception as e:
                    logger.error("Async WebSocket notification failed: %s", e)

            # Run async notification
            await asyncio.get_event_loop().run_in_executor(None, lambda: asyncio.run(notify_websocket_async()))
        else:
            logger.warning("No node_id found for intersection_id=%s", intersection_id)

        logger.info("Successfully updated intersection with id=%s", intersection_id)
        return jsonify({"success": True, "message": "Intersection updated successfully"})
    except psycopg2.Error as e:
        logger.error("Database error updating intersection: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        logger.error("Unexpected error in update_intersection: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/get_node_cams', methods=['GET'])
def get_node_cams():
    node_id = request.args.get('node_id')
    logger.debug("Fetching cams for node_id=%s", node_id)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT id, ip_address FROM cams WHERE node_id = %s", (node_id,))
        cams = cursor.fetchall()
        cursor.close()
        db.close()
        logger.debug("Cams: %s", cams)
        return jsonify(cams)
    except psycopg2.Error as e:
        logger.error("Error fetching node cams: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route('/api/cams/by_intersection', methods=['GET'])
def get_cams_by_intersection():
    lat = float(request.args.get('lat'))
    lng = float(request.args.get('lng'))
    logger.debug("Fetching cams for intersection at lat=%s, lng=%s", lat, lng)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        query = """
            SELECT cams.id, cams.ip_address
            FROM intersections
            JOIN nodes ON intersections.id = nodes.intersection_id
            JOIN cams ON nodes.id = cams.node_id
            WHERE intersections.latitude = %s AND intersections.longitude = %s
        """
        cursor.execute(query, (lat, lng))
        cams = cursor.fetchall()
        cursor.close()
        db.close()
        logger.debug("Cams for intersection: %s", cams)
        return jsonify({"success": True, "data": cams})
    except psycopg2.Error as e:
        logger.error("Error fetching cams by intersection: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/get_vehicle_count_by_day', methods=['GET'])
def get_vehicle_count_by_day():
    node_id = request.args.get('node_id', type=int)
    logger.debug("Fetching vehicle count for node_id=%s", node_id)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT intersection_id FROM nodes WHERE id = %s", (node_id,))
        row = cursor.fetchone()
        if not row:
            cursor.close()
            db.close()
            return jsonify({"error": "Node not found"}), 404

        intersection_id = row['intersection_id']
        cursor.execute("""
            WITH ranked AS (
                SELECT
                    TO_CHAR(time, 'Day')          AS weekday,
                    TRIM(TO_CHAR(time, 'Day'))    AS weekday_trim,
                    EXTRACT(DOW FROM time)        AS dow,
                    vehicles_count,
                    ROW_NUMBER() OVER (
                        PARTITION BY EXTRACT(DOW FROM time)
                        ORDER BY vehicles_count
                    )                             AS row_num,
                    COUNT(*) OVER (
                        PARTITION BY EXTRACT(DOW FROM time)
                    )                             AS total_count
                FROM history
                WHERE intersection_id = %s
            )
            SELECT
                weekday_trim                      AS weekday,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vehicles_count) AS median_count
            FROM ranked
            GROUP BY weekday_trim, dow
            ORDER BY dow
        """, (intersection_id,))
        results = cursor.fetchall()
        cursor.close()
        db.close()

        final_data = []
        for row in results:
            final_data.append({
                'weekday': row['weekday'],
                'median_count': round(row['median_count'], 2)
            })
        logger.debug("Vehicle count data: %s", final_data)
        return jsonify(final_data)
    except psycopg2.Error as e:
        logger.error("Error fetching vehicle count: %s", e)
        return jsonify({"error": str(e)}), 500
    
@app.route('/get_congestion_times', methods=['GET'])
def get_congestion_times():
    governorate = request.args.get('governorate')
    logger.debug("Fetching congestion times for governorate=%s", governorate)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        query = """
            SELECT 
                EXTRACT(HOUR FROM time) AS hour,
                AVG(vehicles_count) AS avg_vehicles
            FROM history
            JOIN intersections ON history.intersection_id = intersections.id
            WHERE intersections.governorate = %s
            GROUP BY hour
            ORDER BY hour
        """
        cursor.execute(query, (governorate,))
        data = cursor.fetchall()
        cursor.close()
        db.close()
        
        result = []
        for hour in range(24):
            hour_data = next((item for item in data if item['hour'] == hour), None)
            result.append({
                'hour': hour,
                'avg_vehicles': round(hour_data['avg_vehicles'], 2) if hour_data else 0
            })
        
        logger.debug("Congestion times data: %s", result)
        return jsonify(result)
    except psycopg2.Error as e:
        logger.error("Error fetching congestion times: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route('/get_congestion_areas', methods=['GET'])
def get_congestion_areas():
    governorate = request.args.get('governorate')
    logger.debug("Fetching congestion areas for governorate=%s", governorate)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        query = """
            SELECT 
                intersections.address,
                intersections.latitude,
                intersections.longitude,
                ROUND(AVG(history.vehicles_count)::numeric, 2)  AS avg_vehicles,
                EXTRACT(HOUR FROM history.time) AS peak_hour
            FROM history
            JOIN intersections ON history.intersection_id = intersections.id
            WHERE intersections.governorate = %s
            GROUP BY intersections.id, intersections.address, intersections.latitude, intersections.longitude, HOUR(history.time)
            HAVING ROUND(AVG(history.vehicles_count)::numeric, 2) > 50
            ORDER BY avg_vehicles DESC
            LIMIT 5
        """
        cursor.execute(query, (governorate,))
        data = cursor.fetchall()
        cursor.close()
        db.close()
        
        # Ensure data is properly formatted
        formatted_data = [{
            'address': item['address'],
            'latitude': float(item['latitude']),
            'longitude': float(item['longitude']),
            'avg_vehicles': float(item['avg_vehicles']),
            'peak_hour': item['peak_hour']
        } for item in data]
        
        logger.debug("Congestion areas raw data: %s", data)
        logger.debug("Congestion areas formatted data: %s", formatted_data)
        return jsonify(formatted_data)
    except psycopg2.Error as e:
        logger.error("Error fetching congestion areas: %s", e)
        return jsonify({"error": str(e)}), 500
    
@app.route('/api/notifications', methods=['GET'])
def filter_notifications_by_governorate():
    governorate = request.args.get('governorate')
    node_id = request.args.get('node_id')
    logger.debug("Filtering notifications by governorate=%s", governorate)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        if governorate:
            query = """
                SELECT 
                notifications.content,
                notifications.time,
                intersections.governorate,
                intersections.address
                FROM notifications
                JOIN intersections ON notifications.intersection_id = intersections.id
                WHERE intersections.governorate = %s
            """
            cursor.execute(query, (governorate,))
        elif node_id:
            query = """
                SELECT 
                notifications.content,
                notifications.time,
                intersections.governorate,
                intersections.address
                FROM notifications
                JOIN intersections ON notifications.intersection_id = intersections.id
                JOIN nodes ON intersections.id = nodes.intersection_id
                WHERE nodes.id = %s
            """
            cursor.execute(query, (node_id,))
        else:
            query = """
                SELECT 
                notifications.content,
                notifications.time,
                intersections.governorate,
                intersections.address
                FROM notifications
                JOIN intersections ON notifications.intersection_id = intersections.id
            """
            cursor.execute(query)
        
        data = cursor.fetchall()
        cursor.close()
        db.close()
        logger.debug("Filtered notifications: %s", data)
        return jsonify({"success": True, "data": data})
    except psycopg2.Error as e:
        logger.error("Error filtering notifications: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/cams', methods=['GET'])
def get_cams():
    node_id = request.args.get('node_id')
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT * FROM cams WHERE node_id = %s", (node_id,))
        cams = cursor.fetchall()
        cursor.close()
        return jsonify({"success": True, "data": cams})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    
@app.route('/get_notifications_count', methods=['GET'])
def get_notifications_count():
    node_id = request.args.get('node_id')
    date = request.args.get('date')  
    logger.debug("Fetching notification count for node_id=%s, date=%s", node_id, date)
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # First, get intersection_id from nodes table
        cursor.execute("SELECT intersection_id FROM nodes WHERE id = %s", (node_id,))
        node = cursor.fetchone()
        if not node:
            cursor.close()
            conn.close()
            logger.debug("Node not found for node_id=%s", node_id)
            return jsonify({'count': 0, 'error': 'Node not found'}), 404

        intersection_id = node['intersection_id']
        # Count notifications for the intersection_id on the given date
        query = """
            SELECT COUNT(*) as count
            FROM notifications
            WHERE intersection_id = %s AND time::date = %s
        """
        cursor.execute(query, (intersection_id, date))
        result = cursor.fetchone()
        count = result['count'] if result else 0
        cursor.close()
        conn.close()
        logger.debug("Notification count for intersection_id=%s: %d", intersection_id, count)
        return jsonify({'count': count})
    except psycopg2.Error as e:
        logger.error("Error fetching notification count: %s", e)
        return jsonify({'count': 0, 'error': str(e)}), 500
    
@app.route('/api/nodes', methods=['GET'])
def get_nodes():
    intersection_id = request.args.get('intersection_id')
    logger.debug("Fetching nodes for intersection_id=%s", intersection_id)
    try:
        db = get_db_connection()
        cursor = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT id FROM nodes WHERE intersection_id = %s", (intersection_id,))
        nodes = cursor.fetchall()
        cursor.close()
        db.close()
        logger.debug("Nodes: %s", nodes)
        return jsonify({"success": True, "data": nodes})
    except psycopg2.Error as e:
        logger.error("Error fetching nodes: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

# Frontend static file serving routes
@app.route('/')
def dashboard():
    return send_from_directory(os.path.join(FRONTEND_DIR, 'pages'), 'dashboard.html')

@app.route('/pages/<path:filename>')
def pages(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'pages'), filename)

@app.route('/js/<path:filename>')
def js(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'js'), filename)

@app.route('/css/<path:filename>')
def css(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'css'), filename)

@app.route('/img/<path:filename>')
def img(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'img'), filename)

@app.route('/<path:filename>')
def static_files(filename):
    """Catch-all for any other static files in pages directory"""
    pages_dir = os.path.join(FRONTEND_DIR, 'pages')
    file_path = os.path.join(pages_dir, filename)
    if os.path.isfile(file_path):
        return send_from_directory(pages_dir, filename)
    return jsonify({"error": "File not found"}), 404


if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=5000)