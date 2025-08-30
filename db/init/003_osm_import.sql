-- Punkte mit amenity=drinking_water
INSERT INTO features (name, type, geom, source, osm_id)
SELECT
  COALESCE(p.name, 'Trinkbrunnen') AS name,
  'Trinkbrunnen' AS type,
  p.way::geography,
  'osm_osm2pgsql' AS source,
  p.osm_id
FROM planet_osm_point p
WHERE p.amenity = 'drinking_water'
  AND NOT EXISTS (
    SELECT 1 FROM features f
    WHERE f.type = 'Trinkbrunnen'
      AND (
        (p.osm_id IS NOT NULL AND f.osm_id = p.osm_id)
        OR
        (p.osm_id IS NULL AND ST_Equals(f.geom::geometry, p.way))
      )
  );

-- Flächen (Mittelpunkt) mit amenity=drinking_water
INSERT INTO features (name, type, geom, source, osm_id)
SELECT
  COALESCE(poly.name, 'Trinkbrunnen') AS name,
  'Trinkbrunnen' AS type,
  ST_Centroid(poly.way)::geography AS geom,
  'osm_osm2pgsql' AS source,
  poly.osm_id
FROM planet_osm_polygon poly
WHERE poly.amenity = 'drinking_water'
  AND NOT EXISTS (
    SELECT 1 FROM features f
    WHERE f.type = 'Trinkbrunnen'
      AND (
        (poly.osm_id IS NOT NULL AND f.osm_id = poly.osm_id)
        OR
        (poly.osm_id IS NULL AND ST_Equals(f.geom::geometry, ST_Centroid(poly.way)))
      )
  );
