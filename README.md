CoolCity Berlin


Project Overview:

This web application provides interactive routing and geospatial analysis for OpenStreetMap data, using a React frontend, FastAPI backend, and PostGIS database. Routing is powered by Valhalla. 
The app visualizes features such as benches and water fountains for Berlin-Mitte, for the user to find a cool place for a break when visiting Berlin Mitte. Also the user is able to delete features if recognized that the features have been removed. Furthermore the user can also add new features if new owns appear in the city. The changes will be stored in the database immediately and will influence other users. All changes can be reset by the click of a button.  
The routing is intended to show how to get from point A to point B and additionally when clicking on "green route" it shows the greenest route, with the most trees and parks within it to ensure more shadowing.


Prerequisites:

Docker Desktop (Windows, Mac, or Linux)
Git


Quick Start:

git clone https://github.com/SOPHIEfree/osm-project.git
cd osm-project
docker compose up -d --build


Services:

Frontend: React app (port 3000)
- accessible at http://localhost:3000
Backend: FastAPI (port 8000)
- API endpoints for routing and geodata
Valhalla: Routing engine (port 8002)
- used for route calculation


Folder Structure:

frontend: React source code
backend: FastAPI backend, including routing logic and a data folder
db: Database initialization scripts
docker-compose.yml: Service orchestration


Usage:

1. Clone the repository and start all services with Docker Compose (see above).
2. Open your browser at http://localhost:3000 to use the webapp.
3. The backend API is available at http://localhost:8000.
4. Valhalla routing API is available at http://localhost:8002.


Data:

GeoJSON buffer for Berlin-Mitte is located in data. It was used to query for the features contained in Mitte.
GeoJSON of parks and trees are in custom_areas and have been used for valhalla for the green route calculation.
GEoJSON with the features is also located in data and used as the input for the database. The database only contains the features and the boundary of Berlin-Mitte.


API Endpoints (Backend):

/api/route: Standard routing
/api/green-route: Green routing (environmental criteria)


Troubleshooting:

If you encounter issues, ensure Docker Desktop is running and ports 3000, 8000 and 8002 are free.
For backend errors, check logs with docker compose logs backend.
For frontend errors, check logs with docker compose logs frontend.


Notes:

No authentication required for basic usage. As a next step for this website development the user should be able to log in, so individual routes can be saved, and new features can be added (favorite shop, etc.).
All data is local; no external API keys needed.
For the routing it has to be noticed, that the calculation of the green route should, as a next step, be improved, as for some cases it prioritizes trees over parks, which shouldn't lead to the greenest route. 

Sources:

1. The GeoJSON of the features was created by downloading the features data of https://github.com/technologiestiftung/erfrischungskarte-frontend/ and only querying for the features we needed in Berlin-Mitte.
2. The data of the trees and parks originate from openstreetmap. A buffer was created around those featured in QGIS in order for valhalla to use it properly for the green route.
3. The Berlin-Mitte boundary was obtained from Overpass Turbo.
Note that the VS Code Copilot was used to help to generate the code and the text fields. 
4. The icon of CoolCity was created by ChatGPT 5.

Credits:

Built with React, FastAPI, PostGIS, and Valhalla.



