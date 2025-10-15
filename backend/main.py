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

# CORS: allow frontend access
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

# Debug endpoints
@app.get("/debug/trees")
async def get_trees_debug():
    """Debug: Load tree features"""
    import os
    trees_file = "/data/custom_areas/trees_buffer_mitte.geojson"
    
    if not os.path.exists(trees_file):
        return {"error": f"File not found: {trees_file}"}
    
    try:
        with open(trees_file, 'r') as f:
            trees_data = json.load(f)

        features = trees_data.get("features", [])  
        return {
            "type": "FeatureCollection",
            "features": features,
            "total_features": len(trees_data.get("features", []))
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug/parks")  
async def get_parks_debug():
    """Debug: Load park features"""
    import os
    parks_file = "/data/custom_areas/parks_buffer_mitte.geojson"
    
    if not os.path.exists(parks_file):
        return {"error": f"File not found: {parks_file}"}
    
    try:
        with open(parks_file, 'r') as f:
            parks_data = json.load(f)

        features = parks_data.get("features", [])  
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
    """Simple trees endpoint for quick browser testing"""
    try:
        with open("/data/custom_areas/trees_buffer_mitte.geojson", 'r') as f:
            data = json.load(f)
        return {
            "message": f"Successfully loaded {len(data.get('features', []))} tree features!",
            "count": len(data.get('features', [])),
            "first_feature": data.get('features', [{}])[0] if data.get('features') else None
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/route")
async def route(body: dict):
    """Simple proxy to Valhalla route endpoint.

    Expects a JSON body with:
      - points: list of [lon, lat] pairs (at least two)
      - costing: optional (pedestrian/bicycle/auto)
      - alternatives: optional number of alternatives (max 3)
    Returns the Valhalla response JSON.
    """
    pts = body.get("points", [])
    if len(pts) < 2:
        return {"error": "need at least two points [[lon,lat],[lon,lat]]"}

    locations = [{"lat": lat, "lon": lon} for lon, lat in pts]

    payload = {
        "locations": locations,
        "costing": body.get("costing", "pedestrian"),
        "costing_options": {
            "pedestrian": {
                "walking_speed": 5.1,
                "step_penalty": 0,
                "max_hiking_difficulty": 6,
                "use_ferry": 0.0,
                "use_living_streets": 1.0,
                "use_tracks": 0.5,
                "shortest": True,
            }
        },
        "directions_options": {"units": "kilometers", "language": "de"},
    }

    alternatives = body.get("alternatives", 1)
    if alternatives > 1:
        payload["alternates"] = min(alternatives, 3)

    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(f"{VALHALLA_URL}/route", json=payload)
        r.raise_for_status()
        return r.json()

@app.post("/api/green-route")
async def green_route(body: dict):
    """Compute a green-aware pedestrian route.

    Body parameters:
      - points: list of [lon, lat] pairs (at least two)
      - max_extra_minutes: allowed additional minutes compared to the base route
      - prefer_parks / prefer_trees: booleans to include parks/trees

    The function computes a base pedestrian route, requests multiple
    pedestrian alternatives with parameters favoring footways/tracks, and
    selects the route that overlaps most with configured green polygons.
    """
    pts = body.get("points", [])
    if len(pts) < 2:
        return {"error": "need at least two points [[lon,lat],[lon,lat]]"}

    max_extra_minutes = body.get("max_extra_minutes", 5)
    prefer_parks = body.get("prefer_parks", True)
    prefer_trees = body.get("prefer_trees", True)

    locations = [{"lat": lat, "lon": lon} for lon, lat in pts]

    base_payload = {"locations": locations, "costing": "pedestrian", "directions_options": {"units": "kilometers"}}

    async with httpx.AsyncClient(timeout=60.0) as client:
        base_response = await client.post(f"{VALHALLA_URL}/route", json=base_payload)
        base_response.raise_for_status()
        base_data = base_response.json()

        base_time = 0
        if base_data.get("trip", {}).get("legs"):
            base_time = base_data["trip"]["legs"][0]["summary"]["time"]

        green_polygons = load_green_polygons(prefer_parks, prefer_trees)

        green_payload = {
            "locations": locations,
            "costing": "pedestrian",
            "alternates": 10,
            "costing_options": {
                "pedestrian": {
                    "shortest": False,
                    "use_roads": 0.2,
                    "use_tracks": 1.0,
                    "use_footway": 1.0,
                    "use_living_streets": 0.8,
                    "use_sidewalk": 0.9,
                    "walking_speed": 5.1,
                    "step_penalty": 0,
                    "max_hiking_difficulty": 6,
                    "walkway_factor": 1.8,
                    "sidewalk_factor": 1.4,
                    "alley_factor": 0.9,
                    "driveway_factor": 0.7,
                }
            },
            "directions_options": {"units": "kilometers"},
        }

        green_response = await client.post(f"{VALHALLA_URL}/route", json=green_payload)
        green_response.raise_for_status()
        green_data = green_response.json()

        if green_polygons:
            green_leg = select_greenest_route(green_data, green_polygons)
        else:
            green_leg = green_data.get("trip", {}).get("legs", [{}])[0]

        green_time = 0
        if green_leg and green_leg.get("summary"):
            green_time = green_leg["summary"]["time"]

        extra_time_minutes = (green_time - base_time) / 60

        if extra_time_minutes > max_extra_minutes:
            return {"success": False, "message": f"Green route would take {extra_time_minutes:.1f} minutes longer (limit: {max_extra_minutes} min)", "base_route": base_data, "extra_time": extra_time_minutes}

        return {"success": True, "green_route": {"trip": {"legs": [green_leg]}} if green_leg else green_data, "base_route": base_data, "extra_time": extra_time_minutes, "green_polygons_used": len(green_polygons) if green_polygons else 0}

def load_green_polygons(prefer_parks=True, prefer_trees=True):
    """Load green areas and convert them to Valhalla-compatible polygons."""
    polygons = []
    
    try:
        if prefer_parks:
            parks_file = "/data/custom_areas/parks_buffer_mitte.geojson"
            with open(parks_file, 'r') as f:
                parks_data = json.load(f)
                for feature in parks_data.get('features', []):
                    if feature.get('geometry', {}).get('type') == 'Polygon':
                        # Valhalla expects [lon, lat] coordinates
                        coords = feature['geometry']['coordinates'][0]
                        # Convert to Valhalla format: list of {"lat": x, "lon": y}
                        valhalla_coords = [{"lat": coord[1], "lon": coord[0]} for coord in coords]
                        polygons.append(valhalla_coords)
                print(f"Parks loaded: {len(parks_data.get('features', []))} features")
                
        if prefer_trees:
            trees_file = "/data/custom_areas/trees_buffer_mitte.geojson"
            with open(trees_file, 'r') as f:
                trees_data = json.load(f)
                for feature in trees_data.get('features', []):
                    if feature.get('geometry', {}).get('type') == 'Polygon':
                        coords = feature['geometry']['coordinates'][0]
                        valhalla_coords = [{"lat": coord[1], "lon": coord[0]} for coord in coords]
                        polygons.append(valhalla_coords)
                print(f"Trees loaded: {len(trees_data.get('features', []))} features")
                
    except Exception as e:
        print(f"Error loading green areas: {e}")
        
    print(f"Loaded {len(polygons)} green polygons for Valhalla in total")
    return polygons

def create_inverse_polygons(green_polygons):
    """Create avoid_polygons outside the green areas (placeholder)."""
    return []

def select_greenest_route(route_response, green_polygons):
    """Select the route that goes through the most green areas."""
    
    trip = route_response.get("trip", {})
    legs = trip.get("legs", [])
    
    if not legs:
        return None
        
    # If only one route is returned, use it
    if len(legs) == 1:
        return legs[0]
    
    # Score each route by its "greenness"
    best_route = None
    best_green_score = -1
    
    for leg in legs:
        green_score = calculate_green_score(leg, green_polygons)
        if green_score > best_green_score:
            best_green_score = green_score
            best_route = leg
            
    return best_route if best_route else legs[0]

def calculate_green_score(route_leg, green_polygons):
    """Calculate how 'green' a route is based on overlap with green polygons.

    The function decodes the Valhalla polyline (if present) and samples every
    5th point to check whether it lies inside any supplied green polygon. If
    shapely/polyline are not available or an error occurs, a simple heuristic
    based on route summary (time/length) is returned.
    """
    if not green_polygons:
        return 0

    # Decode the route shape to coordinates
    shape = route_leg.get("shape", "")
    if not shape:
        return 0

    try:
        import polyline
        from shapely.geometry import Point, Polygon

        coordinates = polyline.decode(shape)
        total_points = len(coordinates)
        if total_points == 0:
            return 0

        green_points = 0
        # Sample every 5th point for performance
        sampled = coordinates[::5]
        for lat, lon in sampled:
            if is_point_in_green_areas_precise(lat, lon, green_polygons):
                green_points += 1

        denom = max(1, len(sampled))
        return green_points / denom

    except Exception as e:
        print(f"Error calculating green score: {e}")
        # Fallback: simple heuristic based on route summary
        summary = route_leg.get("summary", {})
        time_score = summary.get("time", 0) / 3600
        length_score = summary.get("length", 0) / 1000
        return time_score * 0.6 + length_score * 0.4

def is_point_in_green_areas_precise(lat, lon, green_polygons):
    """Precise point-in-polygon test using Shapely."""
    try:
        from shapely.geometry import Point, Polygon
        
        point = Point(lon, lat)
        
        for poly_coords in green_polygons:
            try:
                # Convert Valhalla-format to Shapely Polygon
                coords = [(coord["lon"], coord["lat"]) for coord in poly_coords]
                if len(coords) >= 3:  # At least 3 points for a polygon
                    polygon = Polygon(coords)
                    if polygon.is_valid and polygon.contains(point):
                        return True
            except Exception:
                continue
                
        return False
    except ImportError:
        # Fallback to a simpler test if Shapely is not available
        return is_point_in_green_areas(lat, lon, green_polygons)

def is_point_in_green_areas(lat, lon, green_polygons):
    """Simplified point-in-polygon test without external libraries.

    This uses a bounding-box approximation for performance and when shapely
    is not installed.
    """

    # Simple bounding-box test as an approximation
    for poly_coords in green_polygons:
        try:
            lats = [coord["lat"] for coord in poly_coords]
            lons = [coord["lon"] for coord in poly_coords]
            
            min_lat, max_lat = min(lats), max(lats)
            min_lon, max_lon = min(lons), max(lons)
            
            # Point inside bounding box?
            if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                return True
        except Exception:
            continue
            
    return False

def load_green_areas(prefer_parks=True, prefer_trees=True):
    """Legacy helper - load green areas as plain coordinate arrays."""
    green_areas = []
    
    if prefer_parks:
        try:
            with open("/data/custom_areas/parks_buffer_mitte.geojson", "r") as f:
                parks_data = json.load(f)
                for feature in parks_data.get("features", []):
                    if feature.get("geometry", {}).get("type") == "Polygon":
                        coords = feature["geometry"]["coordinates"][0]  # outer ring
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