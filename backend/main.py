import os
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import psycopg2
import psycopg2.extras
import json



DB_DSN = os.getenv("DB_DSN", "dbname=osm_data user=postgres password=postgres host=db port=5432")

app = FastAPI()

# CORS: Frontend darf zugreifen
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Marker(BaseModel):
    lat: float
    lng: float
    name: str
    type: str  # 'Drinking fountain' | 'Bench' | 'Park'

def get_conn():
    return psycopg2.connect(DB_DSN)

@app.get("/features")
def get_markers():
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        """
        cur.execute(
            SELECT id, name, type,
                   ST_Y(ST_AsText(geom::geometry)) AS lat,
                   ST_X(ST_AsText(geom::geometry)) AS lng
            FROM features
            ORDER BY id;
        )
        """
        cur.execute("""
            SELECT 
            MIN(id) AS id,
            'Bench cluster' AS name,
            'Bench' AS type,
            ST_Y(ST_Centroid(ST_Collect(geom::geometry))) AS lat,
            ST_X(ST_Centroid(ST_Collect(geom::geometry))) AS lng,
            COUNT(*) AS count
            FROM features
            WHERE type = 'Bench'
            GROUP BY ST_SnapToGrid(geom::geometry, 0.001)

            UNION ALL

            SELECT 
            id, name, type,
            ST_Y(geom::geometry) AS lat,
            ST_X(geom::geometry) AS lng,
            1 AS count
            FROM features
            WHERE type <> 'Bench';
        """)

        return list(cur.fetchall())

@app.post("/features")
def add_marker(marker: Marker):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO features (name, type, geom)
            VALUES (%s, %s, ST_GeogFromText(%s))
            RETURNING id;
        """, (marker.name, marker.type, f"POINT({marker.lng} {marker.lat})"))
        new_id = cur.fetchone()[0]
        conn.commit()
    return {"status": "ok", "id": new_id}

@app.post("/reset_features")
def reset_features():
    with get_conn() as conn, conn.cursor() as cur:
        # wipe table
        cur.execute("TRUNCATE features RESTART IDENTITY;")

        # insert only drinking fountains from amenity column
        """ 
        cur.execute(
            INSERT INTO features (name, type, geom, osm_id)
            SELECT
                COALESCE(name, 'Drinking fountain'),
                'Drinking fountain',
                way,
                osm_id
            FROM planet_osm_point
            WHERE amenity = 'drinking_water';
        )
        """
        conn.commit()
    return {"status": "reset_done"}


@app.delete("/features/{fid}")
def delete_marker(fid: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM features WHERE id = %s", (fid,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Feature not found")
        conn.commit()
    return {"status": "deleted", "id": fid}

@app.post("/load_geojson")
def load_geojson():
    filepath = "/data/berlin_poi.geojson"
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE features RESTART IDENTITY;")

        for feature in data["features"]:
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [])
            if not coords or geom.get("type") != "Point":
                continue

            lng, lat = coords
            name = props.get("name") or "Unnamed"
            type_ = props.get("category", "Unknown")

            cur.execute("""
                INSERT INTO features (name, type, geom)
                VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            """, (name, type_, lng, lat))

        conn.commit()

    return {"status": "loaded", "count": len(data["features"])}

@app.get("/districts")
def get_districts():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT name, ST_AsGeoJSON(geom) AS geojson
            FROM berlin_districts;
        """)
        rows = cur.fetchall()
    return [
        {"name": r[0], "geometry": json.loads(r[1])}
        for r in rows
    ]
