-- Punkte mit amenity=drinking_water
INSERT INTO features (name, type, geom, source, osm_id)
SELECT
  COALESCE(p.name, 'Drinking fountain') AS name,
  'Drinking fountain' AS type,
  p.way::geography,
  'osm_osm2pgsql' AS source,
  p.osm_id
FROM planet_osm_point p
WHERE p.amenity = 'drinking_water'
  AND NOT EXISTS (
    SELECT 1 FROM features f
    WHERE f.type = 'Drinking fountain'
      AND (
        (p.osm_id IS NOT NULL AND f.osm_id = p.osm_id)
        OR
        (p.osm_id IS NULL AND ST_Equals(f.geom::geometry, p.way))
      )
  );

-- Flächen (Mittelpunkt) mit amenity=drinking_water
INSERT INTO features (name, type, geom, source, osm_id)
SELECT
  COALESCE(poly.name, 'Drinking fountain') AS name,
  'Drinking fountain' AS type,
  ST_Centroid(poly.way)::geography AS geom,
  'osm_osm2pgsql' AS source,
  poly.osm_id
FROM planet_osm_polygon poly
WHERE poly.amenity = 'drinking_water'
  AND NOT EXISTS (
    SELECT 1 FROM features f
    WHERE f.type = 'Drinking fountain'
      AND (
        (poly.osm_id IS NOT NULL AND f.osm_id = poly.osm_id)
        OR
        (poly.osm_id IS NULL AND ST_Equals(f.geom::geometry, ST_Centroid(poly.way)))
      )
  );
