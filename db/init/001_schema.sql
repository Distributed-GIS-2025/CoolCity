CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS features (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Trinkbrunnen','Sitzbank','Kühler Ort')),
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index für schnelle räumliche Abfragen
CREATE INDEX IF NOT EXISTS features_geom_idx ON features USING GIST (geom);
