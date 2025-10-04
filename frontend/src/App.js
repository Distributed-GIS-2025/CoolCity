import { useState, useEffect} from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, ZoomControl, GeoJSON, Polyline, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';

// Fix für Leaflet Marker Icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

/* ---- Typen (Emoji + Color) ---- */
const TYPES = [
  { value: "Drinking fountain", emoji: "💧", color: "#0ea5e9" },
  { value: "Bench", emoji: "🪑", color: "#a25900ff" },
  { value: "Park", emoji: "🌳", color: "#169d47" },
  { value: "Fountain", emoji: "⛲", color: "#0749b2ff" },
  { value: "Picnic table", emoji: "🍽️", color: "#ff7300ff" },
  { value: "Water playground", emoji: "🏖️", color: "#d40606ff" },
];

/* ---- Klick-Handler: merkt Position für Formular oder Routing ---- */
function ClickHandler({ onClick, onRouteClick, routingMode }) {
  useMapEvents({
    click(e) {
      if (routingMode) {
        onRouteClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      } else {
        onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
  });
  return null;
}

/* ---- Formular-Popup beim Save ---- */
function AddMarkerForm({ position, onAdd, onCancel }) {
  const [type, setType] = useState("Drinking fountain");

  function handleSubmit(e) {
    e.preventDefault();
    onAdd({ ...position, type, name: type });
  }

  return (
    <Popup position={[position.lat, position.lng]} onClose={onCancel}>
      <form onSubmit={handleSubmit} style={{ minWidth: 180 }}>
        <label style={{ display: "block", marginBottom: 6 }}>
          Type:
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ width: "100%", marginTop: 4 }}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </Popup>
  );
}

export default function App() {
  const [markers, setMarkers] = useState([]);
  const [newPosition, setNewPosition] = useState(null);
  const [activeTypes, setActiveTypes] = useState([]); // Start with no features visible
  const [districts, setDistricts] = useState([]);
  
  // Routing State
  const [routingMode, setRoutingMode] = useState(false);
  const [routePoints, setRoutePoints] = useState([]);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  


  /* Filter */
  function toggleType(type) {
    setActiveTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  } 

  /* ---- District load ---- */
  useEffect(() => {
    fetch("http://localhost:8000/districts")
      .then((res) => res.json())
      .then(setDistricts);
  }, []);

  /* ---- Load Features (on-demand) ---- */
  useEffect(() => {
    // Only load features if at least one type is active
    if (activeTypes.length === 0) {
      setMarkers([]);
      return;
    }
    
    fetch("http://localhost:8000/features")
      .then((res) => res.json())
      .then((data) => {
        const casted = data.map((d) => ({
          ...d,
          id: d.id,
          lat: Number(d.lat),
          lng: Number(d.lng),
          type: d.type || d.name,
        }));
        console.log("Fetched markers:", casted.length, casted[0]);
        setMarkers(casted);
      })
      .catch((e) => console.error("GET /features failed:", e));
  }, [activeTypes]);

  /* ---- Save ---- */
  function handleAdd(marker) {
    fetch("http://localhost:8000/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(marker),
    })
      .then((res) => res.json())
      .then((data) => {
        setMarkers((m) => [...m, { ...marker, id: data.id }]);
        setNewPosition(null);
      })
      .catch((e) => console.error("POST failed:", e));
  }

  /* ---- Delete ---- */
  function handleDelete(id) {
    if (!id) return;
    fetch(`http://localhost:8000/features/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
        return fetch("http://localhost:8000/features").then((r) => r.json());
      })
      .then((fresh) => fresh && setMarkers(fresh))
      .catch((e) => console.error("DELETE failed:", e));
  }

  /* ---- Routing Functions ---- */
  function handleRouteClick(position) {
    const newPoints = [...routePoints, position];
    setRoutePoints(newPoints);
    console.log("Route point added:", position, "Total points:", newPoints.length);
    
    if (newPoints.length >= 2) {
      calculateRoute(newPoints);
    }
  }
  
  function calculateRoute(points) {
    const payload = {
      points: points.map(p => [p.lng, p.lat]), // [lon, lat] für Backend
      costing: 'pedestrian'
    };
    
    fetch("http://localhost:8000/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
      console.log("Route response:", data);
      if (data.trip && data.trip.legs && data.trip.legs[0]) {
        const leg = data.trip.legs[0];
        console.log("Encoded polyline:", leg.shape);
        const coords = decodePolyline(leg.shape);
        console.log("Decoded coordinates:", coords);
        console.log("Setting route geometry with", coords.length, "points");
        setRouteGeometry(coords);
        setRouteInfo({
          distance: leg.summary.length.toFixed(2),
          time: Math.round(leg.summary.time / 60),
          unit: leg.summary.units || 'km'
        });
      } else {
        console.error("No route data in response:", data);
      }
    })
    .catch(e => {
      console.error("Routing failed:", e);
      alert("Routing failed: " + e.message);
    });
  }
  
  function clearRoute() {
    setRoutePoints([]);
    setRouteGeometry(null);
    setRouteInfo(null);
  }
  
  function toggleRoutingMode() {
    setRoutingMode(!routingMode);
    if (routingMode) {
      clearRoute();
    }
  }
  
  // Polyline decoder (Valhalla verwendet encoded polylines)
  function decodePolyline(encoded) {
    console.log("Decoding polyline of length:", encoded.length);
    
    if (!encoded || encoded.length === 0) {
      console.error("Empty encoded polyline");
      return [];
    }
    
    const poly = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0, lng = 0;
    
    try {
      while (index < len) {
        let b, shift = 0, result = 0;
        
        // Decode latitude
        do {
          if (index >= len) break;
          b = encoded.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        
        // Decode longitude
        shift = 0;
        result = 0;
        do {
          if (index >= len) break;
          b = encoded.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        
        const point = [lat / 1e6, lng / 1e6]; // Valhalla might use 1e6 precision
        poly.push(point);
        
        // Debug first few points
        if (poly.length <= 3) {
          console.log(`Point ${poly.length}:`, point);
        }
      }
      
      console.log("Decoded", poly.length, "points");
      console.log("First point:", poly[0]);
      console.log("Last point:", poly[poly.length - 1]);
      
      return poly;
    } catch (error) {
      console.error("Error decoding polyline:", error);
      return [];
    }
  }

  return (
    <>
      {/* Toolbar oben links */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "white",
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: "6px 8px",
          boxShadow: "0 4px 16px rgba(0,0,0,.15)"
        }}
      >
        {/* Routing Button */}
        <button
          onClick={toggleRoutingMode}
          style={{
            background: routingMode ? "#007bff" : "#f8f9fa",
            color: routingMode ? "white" : "black",
            border: "1px solid #ddd",
            borderRadius: 4,
            padding: "4px 8px",
            cursor: "pointer",
            marginBottom: 4,
            width: "100%"
          }}
        >
          🗺️ {routingMode ? "Exit Routing" : "Start Routing"}
        </button>

        {routingMode && (
          <>
            <div style={{ fontSize: "12px", color: "#666", marginBottom: 4 }}>
              Click on map to add route points
            </div>
            {routePoints.length > 0 && (
              <button
                onClick={clearRoute}
                style={{
                  background: "#dc3545",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  padding: "4px 8px",
                  cursor: "pointer",
                  width: "100%",
                  marginBottom: 4
                }}
              >
                Clear Route ({routePoints.length} points)
              </button>
            )}
            {routeInfo && (
              <div style={{ 
                fontSize: "12px", 
                background: "#e9ecef", 
                padding: 4, 
                borderRadius: 4,
                marginBottom: 4
              }}>
                📍 {routeInfo.distance} {routeInfo.unit}<br/>
                ⏱️ {routeInfo.time} min
              </div>
            )}
          </>
        )}

        <button
          onClick={() =>
            fetch("http://localhost:8000/reset_features", { method: "POST" })
              .then((r) => r.json())
              .then(() =>
                fetch("http://localhost:8000/features")
                  .then((r) => r.json())
                  .then(setMarkers)
              )
          }
        >
          ♻️ Reset from OSM
        </button>
        
        {TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => toggleType(t.value)}
            style={{
              opacity: activeTypes.includes(t.value) ? 1 : 0.4
            }}
          >
            {t.emoji} {t.value}
          </button>
        ))}
      </div>

      <MapContainer 
        center={[52.532, 13.366]} 
        zoom={13} 
        scrollWheelZoom
        zoomControl={false} 
      >
        <ZoomControl position="topright" /> 
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler 
          onClick={(pos) => setNewPosition(pos)} 
          onRouteClick={handleRouteClick}
          routingMode={routingMode}
        />


        {/* Route Polyline */}
        {routeGeometry && (
          <>
            {console.log("Rendering Polyline with geometry:", routeGeometry)}
            <Polyline
              positions={routeGeometry}
              color="#007bff"
              weight={5}
              opacity={0.8}
            />
          </>
        )}

        {/* Route Points */}
        {routePoints.map((point, index) => (
          <Marker
            key={index}
            position={[point.lat, point.lng]}
          >
            <Popup>
              Route Point {index + 1}<br/>
              {index === 0 ? "🚩 Start" : index === routePoints.length - 1 ? "🏁 End" : "📍 Waypoint"}
            </Popup>
          </Marker>
        ))}

        {/* Benches clustering */}
        <MarkerClusterGroup 
          chunkedLoading 
          spiderfyOnEveryZoom={false}  
          showCoverageOnHover={false}
          maxClusterRadius={50}
          disableClusteringAtZoom={16}
          iconCreateFunction={(cluster) => {
            const color = TYPES.find(t => t.value === "Bench")?.color || "gray";
            return L.divIcon({
              html: `<div style="
                background:${color};
                color:white;
                border-radius:50%;
                width:32px;
                height:32px;
                display:flex;
                align-items:center;
                justify-content:center;
                font-weight:bold;
              ">${cluster.getChildCount()}</div>`,
              className: "custom-cluster",
              iconSize: [32, 32],
            });
          }}
        >
          {markers
            .filter(m => m.type === "Bench" && activeTypes.includes(m.type))
            .map(m => (
              <CircleMarker
                key={m.id}
                center={[m.lat, m.lng]}
                radius={6}
                pathOptions={{
                  fillColor: TYPES.find(t => t.value === m.type)?.color || "yellow",
                  color: "white",
                  weight: 1,
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  <b>{m.type}</b>
                  <div style={{ marginTop: 6 }}>
                    <button type="button" onClick={() => handleDelete(m.id)}>
                      ❌ Delete
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MarkerClusterGroup>
        
        {/* Other types without clustering */}
        {markers
          .filter(m => m.type !== "Bench" && activeTypes.includes(m.type))
          .map(m => (
            <CircleMarker
              key={m.id}
              center={[m.lat, m.lng]}
              radius={6}
              pathOptions={{
                fillColor: TYPES.find(t => t.value === m.type)?.color || "yellow",
                color: "white",
                weight: 1,
                fillOpacity: 1
              }}
            >
              <Popup>
                <b>{m.type}</b>
                <div style={{ marginTop: 6 }}>
                  <button type="button" onClick={() => handleDelete(m.id)}>
                    ❌ Delete
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          ))}

        {/* Districts */}
        {districts.map((d, idx) => (
          <GeoJSON
            key={idx}
            data={d.geometry}
            style={{ color: "red", weight: 2, fillOpacity: 0 }}
          />
        ))}

        {/* Add-Form */}
        {newPosition && !routingMode && (
          <AddMarkerForm
            position={newPosition}
            onAdd={handleAdd}
            onCancel={() => setNewPosition(null)}
          />
        )}
      </MapContainer>
    </>
  );
}