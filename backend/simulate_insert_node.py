import asyncio
from decimal import Decimal
import asyncpg

DB_CONFIG = {
    "host": "localhost",
    "user": "postgres",
    "password": "admin",
    "database": "trafficam_db",
}

async def check_intersection(conn, latitude: Decimal, longitude: Decimal):
    return await conn.fetchrow(
        """
        SELECT id, governorate, address, latitude, longitude, capacity
        FROM intersections
        WHERE latitude = $1
          AND longitude = $2
        LIMIT 1
        """,
        latitude,
        longitude,
    )

async def list_nodes_for_intersection(conn, intersection_id: int):
    return await conn.fetch(
        """
        SELECT id, intersection_id, cams
        FROM nodes
        WHERE intersection_id = $1
        ORDER BY id
        """,
        intersection_id,
    )

async def insert_intersection(conn, governorate: str, address: str, latitude: Decimal, longitude: Decimal, capacity: int):
    return await conn.fetchval(
        """
        INSERT INTO intersections (governorate, address, latitude, longitude, capacity)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        """,
        governorate,
        address,
        latitude,
        longitude,
        capacity,
    )

async def insert_node(conn, intersection_id: int, cams: int):
    return await conn.fetchval(
        """
        INSERT INTO nodes (intersection_id, cams)
        VALUES ($1, $2)
        RETURNING id
        """,
        intersection_id,
        cams,
    )

async def main():
    print("Node insertion simulator")
    latitude = Decimal(input("Latitude: ").strip())
    longitude = Decimal(input("Longitude: ").strip())

    governorate = input("Governorate [Unknown]: ").strip() or "Unknown"
    address = input("Address [Unknown Address]: ").strip() or "Unknown Address"
    capacity_input = input("Capacity [20]: ").strip()
    capacity = int(capacity_input) if capacity_input else 20
    cams_input = input("Cameras / lanes count [1]: ").strip()
    cams = int(cams_input) if cams_input else 1

    async with asyncpg.create_pool(**DB_CONFIG) as pool:
        async with pool.acquire() as conn:
            existing = await check_intersection(conn, latitude, longitude)
            if existing:
                print("\nExisting intersection found:")
                print(f"  id={existing['id']}")
                print(f"  governorate={existing['governorate']}")
                print(f"  address={existing['address']}")
                print(f"  latitude={existing['latitude']}")
                print(f"  longitude={existing['longitude']}")
                print(f"  capacity={existing['capacity']}")
                nodes = await list_nodes_for_intersection(conn, existing['id'])
                if nodes:
                    print("  linked nodes:")
                    for node in nodes:
                        print(f"    node_id={node['id']}, cams={node['cams']}")
                else:
                    print("  no linked nodes found")
                print("\nNo new intersection was created.")
            else:
                choice = input("No exact intersection found. Create a new one? [y/N]: ").strip().lower()
                if choice == 'y':
                    new_id = await insert_intersection(conn, governorate, address, latitude, longitude, capacity)
                    node_id = await insert_node(conn, new_id, cams)
                    print("\nInserted new intersection and node:")
                    print(f"  intersection_id={new_id}")
                    print(f"  node_id={node_id}")
                else:
                    print("No insertion performed.")

if __name__ == '__main__':
    asyncio.run(main())
