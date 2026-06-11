import socket
import subprocess
import webbrowser
import os
import time
import re
import sys

def get_local_ip():
    """Get the local IP address of the machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        print(f"Detected local IP: {ip}")
        return ip
    except Exception as e:
        print(f"Failed to detect local IP: {e}, using 'localhost' as fallback")
        return "0.0.0.0"

def update_js_ip(js_file_path, ip_address):
    """Update the IP address in map_v3.js."""
    try:
        with open(js_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        updated_content = re.sub(r'ipAdress\s*=\s*"[^"]*"', f'ipAdress = "{ip_address}"', content)
        with open(js_file_path, 'w', encoding='utf-8') as file:
            file.write(updated_content)
        print(f"Updated IP in {js_file_path} to {ip_address}")
    except FileNotFoundError:
        print(f"Error: {js_file_path} not found")
    except Exception as e:
        print(f"Error updating {js_file_path}: {e}")

def update_tablesjs_ip(tables_file_path, ip_address):
    """Update the IP address in tables_script.js."""
    try:
        with open(tables_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        updated_content = re.sub(r'ipAddress\s*=\s*"[^"]*"', f'ipAddress = "{ip_address}"', content)
        with open(tables_file_path, 'w', encoding='utf-8') as file:
            file.write(updated_content)
        print(f"Updated IP in {tables_file_path} to {ip_address}")
    except FileNotFoundError:
        print(f"Error: {tables_file_path} not found")
    except Exception as e:
        print(f"Error updating {tables_file_path}: {e}")

def update_statsjs_ip(statistics_file_path, ip_address):
    """Update the IP address in statistics.js."""
    try:
        with open(statistics_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        updated_content = re.sub(r'ipAddress\s*=\s*"[^"]*"', f'ipAddress = "{ip_address}"', content)
        with open(statistics_file_path, 'w', encoding='utf-8') as file:
            file.write(updated_content)
        print(f"Updated IP in {statistics_file_path} to {ip_address}")
    except FileNotFoundError:
        print(f"Error: {statistics_file_path} not found")
    except Exception as e:
        print(f"Error updating {statistics_file_path}: {e}")

def update_notifjs_ip(notif_file_path, ip_address):
    """Update the IP address in notifications.js."""
    try:
        with open(notif_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        updated_content = re.sub(r'ipAddress\s*=\s*"[^"]*"', f'ipAddress = "{ip_address}"', content)
        with open(notif_file_path, 'w', encoding='utf-8') as file:
            file.write(updated_content)
        print(f"Updated IP in {notif_file_path} to {ip_address}")
    except FileNotFoundError:
        print(f"Error: {notif_file_path} not found")
    except Exception as e:
        print(f"Error updating {notif_file_path}: {e}")

def update_websocket_ip(ws_file_path, ip_address):
    """Update the ipAddress variable in the WebSocket server script (app_v3.py)."""
    try:
        with open(ws_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        lines = content.splitlines()
        for i, line in enumerate(lines):
            if 'ipAddress =' in line:
                print(f"Found ipAddress at line {i+1}: {line}")
                for j in range(max(0, i-2), min(len(lines), i+3)):
                    print(f"Line {j+1}: {lines[j]}")
        
        # Update ipAddress variable (match empty or non-empty quoted string)
        ip_regex = r'^\s*ipAddress\s*=\s*[\'"].*[\'"]\s*$'
        ip_replacement = f'    ipAddress = "{ip_address}"'
        updated_content = re.sub(ip_regex, ip_replacement, content, flags=re.MULTILINE)
        
        if content == updated_content:
            print(f"Warning: Regex update failed for ipAddress in {ws_file_path}.")
            print(f"Attempting manual line replacement...")
            updated_lines = []
            found = False
            for line in lines:
                if 'ipAddress =' in line:
                    updated_lines.append(f'    ipAddress = "{ip_address}"')
                    found = True
                else:
                    updated_lines.append(line)
            if found:
                updated_content = '\n'.join(updated_lines)
                print(f"Manually updated ipAddress to {ip_address}")
            else:
                print(f"Error: ipAddress line not found in {ws_file_path}. Please check the file.")
                print(f"Attempting fallback to 0.0.0.0 with regex...")
                updated_content = re.sub(
                    ip_regex,
                    f'    ipAddress = "0.0.0.0"',
                    content,
                    flags=re.MULTILINE
                )
                if content == updated_content:
                    print(f"Error: Fallback to 0.0.0.0 also failed. Please check the ipAddress line in {ws_file_path}.")
                    return
        
        with open(ws_file_path, 'w', encoding='utf-8') as file:
            file.write(updated_content)
        print(f"Updated WebSocket server IP in {ws_file_path} to {ip_address} (or 0.0.0.0 as fallback)")
    except FileNotFoundError:
        print(f"Error: {ws_file_path} not found")
    except Exception as e:
        print(f"Error updating {ws_file_path}: {e}")

def update_flask_websocket_url(flask_script, ip_address):
    """Update the WebSocket client URL in serverAppV2.py."""
    try:
        with open(flask_script, 'r', encoding='utf-8') as file:
            content = file.read()
        
        lines = content.splitlines()
        for i, line in enumerate(lines):
            if 'websockets.connect' in line:
                print(f"Found websockets.connect at line {i+1}: {line}")
                for j in range(max(0, i-2), min(len(lines), i+3)):
                    print(f"Line {j+1}: {lines[j]}")
        
        # Check if update is needed
        current_url = f'ws://{ip_address}:8765/ws'
        if current_url in content:
            print(f"WebSocket URL in {flask_script} is already correct: {current_url}")
            return
        
        # Update URL
        updated_content = re.sub(
            r'websockets\.connect\s*\(\s*["\']ws://[^"\']+:8765/ws["\']\s*\)',
            f'websockets.connect("ws://{ip_address}:8765/ws")',
            content,
            flags=re.MULTILINE
        )
        if content == updated_content:
            print(f"Warning: No WebSocket URL update performed in {flask_script}. Regex may not have matched.")
        else:
            with open(flask_script, 'w', encoding='utf-8') as file:
                file.write(updated_content)
            print(f"Updated WebSocket client URL in {flask_script} to ws://{ip_address}:8765/ws")
    except FileNotFoundError:
        print(f"Error: {flask_script} not found")
    except Exception as e:
        print(f"Error updating {flask_script}: {e}")


def update_consumer_ip(consumer_script, ip_address):
    """Update the WebSocket bind address in consumer.py to 0.0.0.0."""
    try:
        with open(consumer_script, 'r', encoding='utf-8') as file:
            content = file.read()
        updated_content = re.sub(r'IP_ADDRESS\s*=\s*"[^"]*"', 'IP_ADDRESS = "0.0.0.0"', content)
        if content == updated_content:
            print(f"No IP_ADDRESS update needed in {consumer_script}; it may already bind to 0.0.0.0.")
        else:
            with open(consumer_script, 'w', encoding='utf-8') as file:
                file.write(updated_content)
            print(f"Updated consumer bind address in {consumer_script} to 0.0.0.0")
    except FileNotFoundError:
        print(f"Error: {consumer_script} not found")
    except Exception as e:
        print(f"Error updating {consumer_script}: {e}")


def allow_windows_firewall_ports(ports):
    """Add Windows firewall rules for the specified TCP ports."""
    try:
        port_list = ','.join(str(p) for p in ports)
        rule_name = 'TrafficAM Dashboard WebSocket Ports'
        command = [
            'powershell.exe',
            '-NoProfile',
            '-Command',
            f'New-NetFirewallRule -DisplayName "{rule_name}" -Direction Inbound -LocalPort {port_list} -Protocol TCP -Action Allow -Profile Private,Domain'
        ]
        subprocess.run(command, check=True, capture_output=True, text=True)
        print(f"Allowed TCP ports {port_list} through Windows Firewall.")
    except subprocess.CalledProcessError as e:
        print("Failed to add firewall rules. You may need to run this script as Administrator.")
        print(e.stderr)
    except Exception as e:
        print(f"Error configuring firewall rules: {e}")


def start_flask_server(flask_script):
    """Start the Flask server in a new CMD window."""
    try:
        cmd = ['cmd.exe', '/c', 'start', 'cmd.exe', '/c', 'python', flask_script]
        process = subprocess.Popen(cmd, creationflags=subprocess.CREATE_NEW_CONSOLE, shell=True)
        print(f"Started Flask server ({flask_script}) with PID {process.pid} in a new CMD window on http://0.0.0.0:5000")
        return process
    except Exception as e:
        print(f"Error starting Flask server: {e}")
        return None

def start_websocket_server(ws_script):
    """Start the WebSocket server in a new CMD window."""
    try:
        cmd = ['cmd.exe', '/c', 'start', 'cmd.exe', '/c', 'python', ws_script]
        process = subprocess.Popen(cmd, creationflags=subprocess.CREATE_NEW_CONSOLE, shell=True)
        print(f"Started WebSocket server ({ws_script}) with PID {process.pid} in a new CMD window on ws://<ip>:8765")
        return process
    except Exception as e:
        print(f"Error starting WebSocket server: {e}")
        return None

def open_dashboard(html_file, ip_address):
    """Open the dashboard HTML file in the default browser."""
    try:
        dashboard_url = f'http://{ip_address}:5000/'
        webbrowser.open(dashboard_url)
        print(f"Opened dashboard in browser at {dashboard_url}")
    except Exception as e:
        print(f"Error opening {html_file}: {e}")

def main():
    # File paths
    js_file = r".\frontend\js\my_scripts\map_v3.js"
    tables_file = r".\frontend\js\my_scripts\tables_script.js"
    statistics_file = r".\frontend\js\my_scripts\statistics.js"
    notif_file = r".\frontend\js\my_scripts\notifications.js"
    flask_script = r".\backend\http\serverAppV2.py"
    websocket_script = r".\backend\websocket\ws_server.py"
    consumer_script = r".\backend\websocket\consumer.py"
    html_file = r".\frontend\pages\dashboard.html"

    # Convert to absolute paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    js_file = os.path.join(base_dir, js_file)
    tables_file = os.path.join(base_dir, tables_file)
    statistics_file = os.path.join(base_dir, statistics_file)
    notif_file = os.path.join(base_dir, notif_file)
    flask_script = os.path.join(base_dir, flask_script)
    websocket_script = os.path.join(base_dir, websocket_script)
    html_file = os.path.join(base_dir, html_file)

    # Ensure files exist
    for file_path in [js_file, tables_file, statistics_file, notif_file, flask_script, websocket_script, consumer_script, html_file]:
        if not os.path.exists(file_path):
            print(f"Error: {file_path} does not exist. Please check the file path.")
            return

    # Get local IP
    ip_address = get_local_ip()

    # Update IPs
    update_js_ip(js_file, ip_address)
    update_tablesjs_ip(tables_file, ip_address)
    update_statsjs_ip(statistics_file, ip_address)
    update_notifjs_ip(notif_file, ip_address)
    update_websocket_ip(websocket_script, ip_address)
    update_flask_websocket_url(flask_script, ip_address)
    update_consumer_ip(consumer_script, ip_address)

    # Allow local firewall access for ports 5000, 8765, and 8766
    allow_windows_firewall_ports([5000, 8765, 8766])

    # Start servers
    flask_process = start_flask_server(flask_script)
    websocket_process = start_websocket_server(websocket_script)
    consumer_process = start_websocket_server(consumer_script)

    # Wait for servers
    time.sleep(2)

    # Open dashboard
    open_dashboard(html_file, ip_address)

    # Keep running until interrupted with CTRL C
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Shutting down servers...")
        if flask_process:
            try:
                print(f"Terminating Flask server process tree (PID {flask_process.pid})...")
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(flask_process.pid)], check=False, capture_output=True, text=True)
                flask_process.wait(timeout=5)
                print("Flask server terminated")
            except subprocess.TimeoutExpired:
                print("Warning: Flask server did not terminate cleanly")
            except Exception as e:
                print(f"Error terminating Flask server: {e}")
        if websocket_process:
            try:
                print(f"Terminating WebSocket server process tree (PID {websocket_process.pid})...")
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(websocket_process.pid)], check=False, capture_output=True, text=True)
                websocket_process.wait(timeout=5)
                print("WebSocket server terminated")
            except subprocess.TimeoutExpired:
                print("Warning: WebSocket server did not terminate cleanly")
            except Exception as e:
                print(f"Error terminating WebSocket server: {e}")
        if 'consumer_process' in locals() and consumer_process:
            try:
                print(f"Terminating consumer process tree (PID {consumer_process.pid})...")
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(consumer_process.pid)], check=False, capture_output=True, text=True)
                consumer_process.wait(timeout=5)
                print("Consumer process terminated")
            except subprocess.TimeoutExpired:
                print("Warning: Consumer process did not terminate cleanly")
            except Exception as e:
                print(f"Error terminating consumer process: {e}")
        print("Shutdown complete.")

if __name__ == "__main__":
    main()