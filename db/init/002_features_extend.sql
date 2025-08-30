-- Spalten hinzufügen (idempotent)
ALTER TABLE features ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE features ADD COLUMN IF NOT EXISTS osm_id BIGINT;

-- Performance-Index (NICHT UNIQUE!)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'features_geom_gist'
  ) THEN
    CREATE INDEX features_geom_gist ON features USING GIST ((geom::geometry));
  END IF;
END$$;

-- Optional: eindeutige OSM-ID pro Typ (nur wenn vorhanden)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_features_osm'
  ) THEN
    CREATE UNIQUE INDEX uniq_features_osm
      ON features (type, osm_id)
      WHERE osm_id IS NOT NULL;
  END IF;
END$$;

