import os
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import psycopg2
import psycopg2.extras



DB_DSN = os.getenv("DB_DSN", "dbname=osm_data user=postgres password=postgres host=db port=5432")

app = FastAPI()

# CORS: Frontend darf zugreifen
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Marker(BaseModel):
    lat: float
    lng: float
    name: str
    type: str  # 'Trinkbrunnen' | 'Sitzbank' | 'Kühler Ort'

def get_conn():
    return psycopg2.connect(DB_DSN)

@app.get("/drinking_fountains")
def get_markers():
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, type,
                   ST_Y(ST_AsText(geom::geometry)) AS lat,
                   ST_X(ST_AsText(geom::geometry)) AS lng
            FROM features
            ORDER BY id;
        """)
        return list(cur.fetchall())

@app.post("/drinking_fountains")
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
        # alles löschen
        cur.execute("TRUNCATE features RESTART IDENTITY;")

        # OSM-Daten neu importieren (hier Beispiel für Trinkbrunnen)
        cur.execute("""
            INSERT INTO features (name, type, geom, osm_id)
            SELECT
                coalesce(tags->'name', 'Trinkbrunnen'),
                'Trinkbrunnen',
                way,
                osm_id
            FROM planet_osm_point
            WHERE tags ? 'amenity' AND tags->>'amenity' = 'drinking_water';
        """)

        conn.commit()

    return {"status": "reset_done"}

@app.delete("/drinking_fountains/{fid}")
def delete_marker(fid: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM features WHERE id = %s", (fid,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Feature not found")
        conn.commit()
    return {"status": "deleted", "id": fid}