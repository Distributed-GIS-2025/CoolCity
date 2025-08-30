# OSM Webapp (React + FastAPI + PostGIS)

## Voraussetzungen
- Docker Desktop, Git
- OSM-Extrakt (z. B. Berlin) als `.pbf`

## Start (lokal)
```bash
git clone https://github.com/DEINUSER/REPO.git
cd REPO

# OSM-Datei besorgen (z. B. berlin-latest.osm.pbf) und ablegen als:
#   ./osm/berlin.osm.pbf

docker compose up -d --build

# warten bis die DB "ready to accept connections" loggt:
#   docker compose log