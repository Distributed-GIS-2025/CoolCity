import httpx
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
VALHALLA_URL = os.getenv("VALHALLA_URL", "http://valhalla:8002")

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

# Simple Debug-Test
@app.get("/debug/test")
async def debug_test():
    return {"status": "debug endpoints working"}

# Debug-Endpunkte
@app.get("/debug/trees")
async def get_trees_debug():
    """Debug: Lade Baum-Features"""
    import os
    trees_file = "/data/custom_areas/trees_buffer_mitte.geojson"
    
    if not os.path.exists(trees_file):
        return {"error": f"Datei nicht gefunden: {trees_file}"}
    
    try:
        with open(trees_file, 'r') as f:
            trees_data = json.load(f)

        features = trees_data.get("features", [])  # Alle Bäume laden
        return {
            "type": "FeatureCollection",
            "features": features,
            "total_features": len(trees_data.get("features", []))
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug/parks")  
async def get_parks_debug():
    """Debug: Lade Park-Features"""
    import os
    parks_file = "/data/custom_areas/parks_buffer_mitte.geojson"
    
    if not os.path.exists(parks_file):
        return {"error": f"Datei nicht gefunden: {parks_file}"}
    
    try:
        with open(parks_file, 'r') as f:
            parks_data = json.load(f)

        features = parks_data.get("features", [])  # Alle Parks laden
        return {
            "type": "FeatureCollection", 
            "features": features,
            "total_features": len(parks_data.get("features", []))
        }
    except Exception as e:
        return {"error": str(e)}

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
        cur.execute("""
            SELECT id, name, type,
                   ST_Y(ST_AsText(geom::geometry)) AS lat,
                   ST_X(ST_AsText(geom::geometry)) AS lng
            FROM features
            ORDER BY id;
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
        # wipe features
        cur.execute("TRUNCATE features RESTART IDENTITY;")
        # copy everything back from backup
        cur.execute("""
            INSERT INTO features (id, name, type, geom)
            SELECT id, name, type, geom
            FROM features_backup;
        """)
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

# Valhalla routing service
@app.get("/ping")
async def ping():
    return {"ok": True, "service": "backend"}

@app.get("/trees-simple")
async def get_trees_simple():
    """Einfacher Endpunkt für Bäume - für direkten Browser-Test"""
    try:
        with open("/data/custom_areas/trees_buffer_mitte.geojson", 'r') as f:
            data = json.load(f)
        return {
            "message": f"Erfolgreich {len(data.get('features', []))} Baum-Features geladen!",
            "count": len(data.get('features', [])),
            "first_feature": data.get('features', [{}])[0] if data.get('features') else None
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/route")
async def route(body: dict):
    """
    Erwarte body:
    {
      "points": [[lon,lat],[lon,lat], ...],
      "costing": "pedestrian" | "bicycle" | "auto" (optional),
      "alternatives": 3 (optional, für alternative Routen)
    }
    """
    pts = body.get("points", [])
    if len(pts) < 2:
        return {"error": "need at least two points [[lon,lat],[lon,lat]]"}

    locations = [{"lat": lat, "lon": lon} for lon, lat in pts]  # lon/lat -> lat/lon
    
    # Optimierte Payload für schnellste Fußgängerroute mit Alternativen
    payload = {
        "locations": locations, 
        "costing": body.get("costing", "pedestrian"),
        "costing_options": {
            "pedestrian": {
                "walking_speed": 5.1,      # Standard Gehgeschwindigkeit (nur für Zeitschätzung)
                "step_penalty": 0,         # Keine Strafe für Treppen/Stufen
                "max_hiking_difficulty": 6,
                "use_ferry": 0.0,          # Keine Fähren
                "use_living_streets": 1.0, # Wohnstraßen bevorzugen
                "use_tracks": 0.5,         # Feldwege teilweise erlauben
                "shortest": True         # Schnellste, nicht kürzeste Route
            }
        },
        "directions_options": {
            "units": "kilometers",
            "language": "de"
        }
    }
    
    # Alternative Routen falls gewünscht
    alternatives = body.get("alternatives", 1)
    if alternatives > 1:
        payload["alternates"] = min(alternatives, 3)  # Maximal 3 Alternativen

    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(f"{VALHALLA_URL}/route", json=payload)
        r.raise_for_status()
        return r.json()

@app.post("/api/green-route")
async def green_route(body: dict):
    """
    Grüne Route durch Parks und baumreiche Gebiete.
    Body:
    {
      "points": [[lon,lat],[lon,lat], ...],
      "max_extra_minutes": 5,  # Max. zusätzliche Zeit in Minuten
      "prefer_parks": true,    # Parks bevorzugen
      "prefer_trees": true     # Baumreiche Gebiete bevorzugen
    }
    """
    pts = body.get("points", [])
    if len(pts) < 2:
        return {"error": "need at least two points [[lon,lat],[lon,lat]]"}

    max_extra_minutes = body.get("max_extra_minutes", 5)
    prefer_parks = body.get("prefer_parks", True)
    prefer_trees = body.get("prefer_trees", True)
    
    locations = [{"lat": lat, "lon": lon} for lon, lat in pts]
    
    # Erst normale Route berechnen als Referenz
    base_payload = {
        "locations": locations, 
        "costing": "pedestrian",
        "directions_options": {"units": "kilometers"}
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        base_response = await client.post(f"{VALHALLA_URL}/route", json=base_payload)
        base_response.raise_for_status()
        base_data = base_response.json()
        
        base_time = 0
        if base_data.get("trip", {}).get("legs"):
            base_time = base_data["trip"]["legs"][0]["summary"]["time"]
        
        # Lade grüne Gebiete aus GeoJSON-Dateien
        green_polygons = load_green_polygons(prefer_parks, prefer_trees)
        
        # Ansatz: Mehrere Routen-Alternativen generieren und die "grünste" wählen
        green_payload = {
            "locations": locations,
            "costing": "pedestrian",
            "alternates": 10,  # Generiere 3 alternative Routen
            "costing_options": {
                "pedestrian": {
                    "shortest": False,
                    "use_roads": 0.2,           # Straßen reduziert nutzen
                    "use_tracks": 1.0,          # Waldwege maximal nutzen
                    "use_footway": 1.0,         # Fußwege maximal nutzen  
                    "use_living_streets": 0.8,  # Wohnstraßen mehr nutzen
                    "use_sidewalk": 0.9,        # Gehwege bevorzugen
                    "walking_speed": 5.1,       # Langsamere Geschwindigkeit
                    "step_penalty": 0,
                    "max_hiking_difficulty": 6,
                    "walkway_factor": 1.8,      # Gehwege bevorzugen
                    "sidewalk_factor": 1.4,     # Gehsteige bevorzugen
                    "alley_factor": 0.9,        # Gassen erlauben
                    "driveway_factor": 0.7      # Zufahrten weniger nutzen
                }
            },
            "directions_options": {
                "units": "kilometers"
            }
        }
        
        # Berechne grüne Route
        green_response = await client.post(f"{VALHALLA_URL}/route", json=green_payload)
        green_response.raise_for_status()
        green_data = green_response.json()
        
        # Wähle die grünste Route aus den möglichen Alternativen
        if green_polygons:
            green_leg = select_greenest_route(green_data, green_polygons)
        else:
            # Fallback: erste Route nehmen
            green_leg = green_data.get("trip", {}).get("legs", [{}])[0]
        
        # Zeit vergleichen
        green_time = 0
        if green_leg and green_leg.get("summary"):
            green_time = green_leg["summary"]["time"]
            
        extra_time_minutes = (green_time - base_time) / 60
        
        # Prüfe ob Zeit-Limit eingehalten wird
        if extra_time_minutes > max_extra_minutes:
            return {
                "success": False,
                "message": f"Grüne Route würde {extra_time_minutes:.1f} Minuten länger dauern (Limit: {max_extra_minutes} min)",
                "base_route": base_data,
                "extra_time": extra_time_minutes
            }
        
        return {
            "success": True,
            "green_route": {"trip": {"legs": [green_leg]}} if green_leg else green_data,
            "base_route": base_data,
            "extra_time": extra_time_minutes,
            "green_polygons_used": len(green_polygons) if green_polygons else 0
        }

def load_green_polygons(prefer_parks=True, prefer_trees=True):
    """Lade grüne Gebiete als Valhalla-kompatible Polygone."""
    polygons = []
    
    try:
        if prefer_parks:
            parks_file = "/data/custom_areas/parks_buffer_mitte.geojson"
            with open(parks_file, 'r') as f:
                parks_data = json.load(f)
                for feature in parks_data.get('features', []):
                    if feature.get('geometry', {}).get('type') == 'Polygon':
                        # Valhalla erwartet [lng, lat] Koordinaten
                        coords = feature['geometry']['coordinates'][0]
                        # Konvertiere zu Valhalla Format: Liste von {"lat": x, "lon": y}
                        valhalla_coords = [{"lat": coord[1], "lon": coord[0]} for coord in coords]
                        polygons.append(valhalla_coords)
                print(f"Parks geladen: {len(parks_data.get('features', []))} Features")
                
        if prefer_trees:
            trees_file = "/data/custom_areas/trees_buffer_mitte.geojson"
            with open(trees_file, 'r') as f:
                trees_data = json.load(f)
                for feature in trees_data.get('features', []):
                    if feature.get('geometry', {}).get('type') == 'Polygon':
                        coords = feature['geometry']['coordinates'][0]
                        valhalla_coords = [{"lat": coord[1], "lon": coord[0]} for coord in coords]
                        polygons.append(valhalla_coords)
                print(f"Trees geladen: {len(trees_data.get('features', []))} Features")
                
    except Exception as e:
        print(f"Fehler beim Laden der grünen Gebiete: {e}")
        
    print(f"Insgesamt {len(polygons)} grüne Polygone für Valhalla geladen")
    return polygons

def create_inverse_polygons(green_polygons):
    """Erstelle avoid_polygons außerhalb der grünen Bereiche."""
    return []

def select_greenest_route(route_response, green_polygons):
    """Wähle die Route aus, die am meisten durch grüne Bereiche führt."""
    
    trip = route_response.get("trip", {})
    legs = trip.get("legs", [])
    
    if not legs:
        return None
        
    # Wenn nur eine Route zurückgegeben wird, nimm diese
    if len(legs) == 1:
        return legs[0]
    
    # Bewerte jede Route nach "Grünheit"
    best_route = None
    best_green_score = -1
    
    for leg in legs:
        green_score = calculate_green_score(leg, green_polygons)
        if green_score > best_green_score:
            best_green_score = green_score
            best_route = leg
            
    return best_route if best_route else legs[0]

def calculate_green_score(route_leg, green_polygons):
    """Berechne wie "grün" eine Route ist basierend auf tatsächlicher Überschneidung."""
    
    if not green_polygons:
        return 0
        
    # Dekodiere die Route-Shape zu Koordinaten
    shape = route_leg.get("shape", "")
    if not shape:
        return 0
        
    try:
        import polyline
        from shapely.geometry import Point, Polygon
        
        # Dekodiere Polyline
        coordinates = polyline.decode(shape)
        
        green_points = 0
        total_points = len(coordinates)
        
        if total_points == 0:
            return 0
        
        # Für jeden Punkt der Route: prüfe ob in grünem Bereich
        for lat, lon in coordinates[::5]:  # Nur jeder 5. Punkt für Performance
            if is_point_in_green_areas_precise(lat, lon, green_polygons):
                green_points += 1
                
        return green_points / (total_points // 5) if total_points > 0 else 0
        
    except Exception as e:
        print(f"Fehler bei Green-Score-Berechnung: {e}")
        # Fallback: einfache Heuristik
        summary = route_leg.get("summary", {})
        time_score = summary.get("time", 0) / 3600  
        length_score = summary.get("length", 0) / 1000 
        return time_score * 0.6 + length_score * 0.4

def is_point_in_green_areas_precise(lat, lon, green_polygons):
    """Präziser Point-in-Polygon-Test mit Shapely."""
    try:
        from shapely.geometry import Point, Polygon
        
        point = Point(lon, lat)
        
        for poly_coords in green_polygons:
            try:
                # Konvertiere Valhalla-Format zu Shapely Polygon
                coords = [(coord["lon"], coord["lat"]) for coord in poly_coords]
                if len(coords) >= 3:  # Mindestens 3 Punkte für Polygon
                    polygon = Polygon(coords)
                    if polygon.is_valid and polygon.contains(point):
                        return True
            except Exception:
                continue
                
        return False
    except ImportError:
        # Fallback zu einfacherem Test
        return is_point_in_green_areas(lat, lon, green_polygons)

def is_point_in_green_areas(lat, lon, green_polygons):
    """Vereinfachte Point-in-Polygon-Test ohne externe Libraries."""
    
    # Einfacher Bounding-Box Test als Näherung
    for poly_coords in green_polygons:
        try:
            lats = [coord["lat"] for coord in poly_coords]
            lons = [coord["lon"] for coord in poly_coords]
            
            min_lat, max_lat = min(lats), max(lats)
            min_lon, max_lon = min(lons), max(lons)
            
            # Punkt in Bounding Box?
            if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                return True
        except Exception:
            continue
            
    return False

def load_green_areas(prefer_parks=True, prefer_trees=True):
    """Legacy-Funktion - lade als einfache Koordinaten-Arrays."""
    green_areas = []
    
    if prefer_parks:
        try:
            with open("/data/custom_areas/parks_buffer_mitte.geojson", "r") as f:
                parks_data = json.load(f)
                for feature in parks_data.get("features", []):
                    if feature.get("geometry", {}).get("type") == "Polygon":
                        coords = feature["geometry"]["coordinates"][0]  # Äußerer Ring
                        green_areas.append(coords)
        except FileNotFoundError:
            pass
    
    if prefer_trees:
        try:
            with open("/data/custom_areas/trees_buffer_mitte.geojson", "r") as f:
                trees_data = json.load(f)
                for feature in trees_data.get("features", []):
                    if feature.get("geometry", {}).get("type") == "Polygon":
                        coords = feature["geometry"]["coordinates"][0]  # Äußerer Ring
                        green_areas.append(coords)
        except FileNotFoundError:
            pass
    
    return green_areas