import { useState, useEffect} from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, ZoomControl, GeoJSON, Polyline, Marker, Polygon } from "react-leaflet";
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
  
  // Green Route State
  const [greenRouteMode, setGreenRouteMode] = useState(false);
  const [maxExtraMinutes, setMaxExtraMinutes] = useState(10);
  const [greenRouteGeometry, setGreenRouteGeometry] = useState(null);
  const [baseRouteGeometry, setBaseRouteGeometry] = useState(null);
  
  // Debug-Features
  const [debugTrees, setDebugTrees] = useState([]);
  const [debugParks, setDebugParks] = useState([]);
  const [showDebugTrees, setShowDebugTrees] = useState(false);
  const [showDebugParks, setShowDebugParks] = useState(false); // Basis-Route für Vergleich
  
  // Explore City
  const [exploreOpen, setExploreOpen] = useState(false);



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

  // Auto-load Debug Features
  useEffect(() => {
    // Automatisch Debug-Features beim Start laden, aber NICHT anzeigen
    loadDebugTrees();
    loadDebugParks();
    // Entfernt: setTimeout zum automatischen Anzeigen
    // setTimeout(() => {
    //   setShowDebugTrees(true);
    //   setShowDebugParks(true);
    // }, 2000);
  }, []);

  // Automatische Neuberechnung wenn Green Route Modus geändert wird
  useEffect(() => {
    console.log('useEffect triggered: greenRouteMode =', greenRouteMode, 'routePoints.length =', routePoints.length);
    
    if (routePoints.length >= 2) {
      console.log('🔄 Green Route mode changed to:', greenRouteMode, '- Recalculating route...');
      
      if (greenRouteMode) {
        // Wechsel zu Green Route
        console.log('→ Switching to GREEN route');
        calculateGreenRoute(routePoints);
      } else {
        // Wechsel zu normaler Route  
        console.log('→ Switching to NORMAL route');
        calculateRoute(routePoints);
        // Lösche grüne Route-Daten
        setGreenRouteGeometry(null);
        setBaseRouteGeometry(null);
      }
    } else {
      console.log('⚠️ Not enough route points for recalculation');
    }
  }, [greenRouteMode, routePoints]); // Abhängigkeiten: beide Werte

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
    // Only allow two waypoints for routing
    if (routePoints.length < 2) {
      const newPoints = [...routePoints, position];
      setRoutePoints(newPoints);

      if (newPoints.length === 2) {
        if (greenRouteMode) {
          calculateGreenRoute(newPoints);
        } else {
          calculateRoute(newPoints);
        }
      }
    }
    // Ignore clicks after two waypoints
  }
  
  function calculateRoute(points) {
    console.log('🛣️ Calculating NORMAL route with', points.length, 'points');
    
    // Lösche zuerst grüne Route-Daten
    setGreenRouteGeometry(null);
    setBaseRouteGeometry(null);
    
    const payload = {
      points: points.map(p => [p.lng, p.lat]), // [lon, lat] für Backend
      costing: 'pedestrian',
      alternatives: 3  // Berechne bis zu 3 alternative Routen
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

  // Debug-Funktionen
  function loadDebugTrees() {
    fetch("http://localhost:8000/debug/trees")
      .then(res => res.json())
      .then(data => {
        console.log("Trees debug data:", data);
        if (data.features) {
          setDebugTrees(data.features);
          // setShowDebugTrees(true); // REMOVE this line!
        }
      })
      .catch(err => console.error("Fehler beim Laden der Bäume:", err));
  }

  function loadDebugParks() {
    fetch("http://localhost:8000/debug/parks")
      .then(res => res.json())
      .then(data => {
        console.log("Parks debug data:", data);
        if (data.features) {
          setDebugParks(data.features);
          // setShowDebugParks(true); // REMOVE this line!
        }
      })
      .catch(err => console.error("Fehler beim Laden der Parks:", err));
  }

  function calculateGreenRoute(points) {
    console.log('🌳 Calculating GREEN route with', points.length, 'points');
    
    // Lösche zuerst normale Route-Daten
    setRouteGeometry(null);
    
    const payload = {
      points: points.map(p => [p.lng, p.lat]),
      max_extra_minutes: maxExtraMinutes,
      prefer_parks: true,
      prefer_trees: true
    };
    
    fetch("http://localhost:8000/api/green-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
      console.log("🌳 Green route response:", data);
      
      if (data.success && data.green_route) {
        console.log("✅ Green route calculation successful!");
        
        // Speichere beide Routen für Vergleich
        const greenLeg = data.green_route.trip.legs[0];
        const baseLeg = data.base_route.trip.legs[0];
        
        const greenCoords = decodePolyline(greenLeg.shape);
        const baseCoords = decodePolyline(baseLeg.shape);
        
        console.log("🌳 Setting greenRouteGeometry:", greenCoords.length, "points");
        console.log("🔵 Setting baseRouteGeometry:", baseCoords.length, "points");
        
        setGreenRouteGeometry(greenCoords);
        setBaseRouteGeometry(baseCoords);
        setRouteInfo({
          distance: greenLeg.summary.length.toFixed(2),
          time: Math.round(greenLeg.summary.time / 60),
          unit: greenLeg.summary.units || 'km',
          extraTime: data.extra_time.toFixed(1),
          type: 'green'
        });
      } else {
        console.log("❌ Green route FAILED:", data.message);
        console.log("❌ Response data:", data);
        
        // Fallback zur normalen Route, aber Green Mode beibehalten
        calculateRoute(points);
        
        // Zeige Benutzer-freundliche Nachricht  
        if (data.message && data.message.includes('länger dauern')) {
          console.warn("💡 Tipp: Erhöhe das 'Max extra time' Limit für grüne Routen!");
          console.log(`⚠️ Grüne Route zu lang! ${data.message}`);
        }
      }
    })
    .catch(e => {
      console.error("❌ Green routing API ERROR:", e);
      // Fallback zur normalen Route bei API-Fehlern
      calculateRoute(points);
    });
  }
  
  function clearRoute() {
    setRoutePoints([]);
    setRouteGeometry(null);
    setGreenRouteGeometry(null);
    setBaseRouteGeometry(null);
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
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: routingMode
              ? "linear-gradient(135deg, #007bff 60%, #00bcd4 100%)"
              : "linear-gradient(135deg, #e0e0e0 60%, #bdbdbd 100%)",
            color: routingMode ? "#fff" : "#222",
            border: "none",
            boxShadow: routingMode
              ? "0 2px 12px rgba(0,123,255,0.18)"
              : "0 2px 8px rgba(0,0,0,0.08)",
            fontSize: "28px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 4,
            transition: "background 0.2s, color 0.2s"
          }}
          title={routingMode ? "Exit Routing" : "Start Routing"}
        >
          🗺️
        </button>

        {routingMode && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            marginTop: 4
          }}>
            <div style={{
              fontSize: "13px",
              color: "#333",
              marginBottom: 2,
              textAlign: "center",
              fontWeight: 500
            }}>
              Click on the map to add <b>start</b> and <b>end</b> points.<br />
              <span style={{ color: "#888", fontSize: "12px" }}>
                (Only two points allowed)
              </span>
            </div>

            {/* Green Route Toggle Button */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 2
            }}>
              <button
                onClick={() => setGreenRouteMode(v => !v)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: greenRouteMode
                    ? "linear-gradient(135deg, #28a745 60%, #169d47 100%)"
                    : "#eee",
                  color: greenRouteMode ? "#fff" : "#169d47",
                  border: "none",
                  boxShadow: greenRouteMode
                    ? "0 2px 8px rgba(40,167,69,0.18)"
                    : "none",
                  fontSize: "26px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.2s, color 0.2s"
                }}
                title="Toggle green route"
              >
                🌳
              </button>
              <span style={{
                fontSize: "13px",
                color: greenRouteMode ? "#169d47" : "#888",
                fontWeight: greenRouteMode ? 600 : 400
              }}>
                {greenRouteMode
                  ? "Green route (through parks & trees)"
                  : "Normal route"}
              </span>
            </div>

            {/* Max Extra Time Slider */}
            {greenRouteMode && (
              <div style={{
                fontSize: "12px",
                marginBottom: 2,
                width: "100%",
                textAlign: "center"
              }}>
                <label>
                  Max extra time: <b>{maxExtraMinutes} min</b>
                </label>
                <input
                  type="range"
                  min="1"
                  max="15"
                  value={maxExtraMinutes}
                  onChange={e => setMaxExtraMinutes(parseInt(e.target.value))}
                  style={{
                    width: "100%",
                    marginTop: 2
                  }}
                />
              </div>
            )}
            
            {routePoints.length > 0 && (
              <button
                onClick={clearRoute}
                style={{
                  background: "linear-gradient(135deg, #ff5252 60%, #ff1744 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "50px",
                  padding: "8px 18px",
                  cursor: "pointer",
                  width: "auto",
                  marginBottom: 4,
                  fontWeight: 700,
                  fontSize: "15px",
                  boxShadow: "0 2px 8px rgba(255,23,68,0.12)",
                  letterSpacing: "0.5px"
                }}
              >
                ❌ Clear Route ({routePoints.length})
              </button>
            )}

            {/* Route Info */}
            {routeInfo && (
              <div style={{
                fontSize: "13px",
                background: routeInfo.type === 'green' ? "#d4edda" : "#e9ecef",
                padding: "8px 10px",
                borderRadius: 6,
                marginTop: 4,
                textAlign: "center",
                fontWeight: 500,
                letterSpacing: "0.2px"
              }}>
                <div style={{ fontSize: "15px", color: "#007bff", fontWeight: 700, marginBottom: 2 }}>
                  Route summary
                </div>
                <div style={{ fontSize: "16px", color: "#222", fontWeight: 700, marginBottom: 2 }}>
                  ⏱️ {routeInfo.time} min
                </div>
                <div style={{ fontSize: "16px", color: "#169d47", fontWeight: 700, marginBottom: 2 }}>
                  📏 {routeInfo.distance} {routeInfo.unit}
                </div>
                {routeInfo.extraTime && (
                  <div style={{ fontSize: "12px", color: "#888", marginTop: 2 }}>
                    Extra time for green route: +{routeInfo.extraTime} min
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Explore the city floating button (middle right) */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          right: 24,
          transform: "translateY(-50%)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
        onClick={e => e.stopPropagation()} // Prevent propagation to map
      >
        {/* Main circle button */}
        <button
          onClick={e => {
            e.stopPropagation();
            setExploreOpen((v) => !v);
          }}
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #4f8cff 60%, #2ecc40 100%)",
            color: "#fff",
            border: "2px solid #007bff",
            boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
            fontSize: "32px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: exploreOpen ? 16 : 0,
            transition: "box-shadow 0.2s"
          }}
          title="Explore the city"
        >
          🏙️
        </button>
        {/* Emoji filter circles and checkboxes */}
        {exploreOpen && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            marginTop: 0,
            position: "relative"
          }}>
            {/* Point filter buttons (emoji only, circle) */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center"
            }}>
              {TYPES.filter(t => t.value !== "Park").map((t, i) => (
                <button
                  key={t.value}
                  onClick={e => {
                    e.stopPropagation();
                    toggleType(t.value);
                  }}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: activeTypes.includes(t.value) ? t.color : "#eee",
                    color: activeTypes.includes(t.value) ? "#fff" : "#888",
                    border: "2px solid #007bff",
                    boxShadow: activeTypes.includes(t.value) ? "0 2px 8px rgba(0,0,0,0.12)" : "none",
                    fontSize: "22px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background 0.2s, color 0.2s"
                  }}
                  title={t.value}
                >
                  {t.emoji}
                </button>
              ))}
            </div>
            {/* Show trees polygons (circle checkbox) */}
            <div style={{
              display: "flex",
              flexDirection: "row",
              gap: 12,
              marginTop: 4,
              alignItems: "center"
            }}>
              <label
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: showDebugTrees ? "#169d47" : "#eee",
                  color: showDebugTrees ? "#fff" : "#888",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: showDebugTrees ? "0 2px 8px rgba(0,0,0,0.12)" : "none",
                  border: "2px solid #007bff",
                  transition: "background 0.2s, color 0.2s"
                }}
                title="Show Trees"
                onClick={e => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={showDebugTrees}
                  onChange={e => {
                    e.stopPropagation();
                    setShowDebugTrees(e.target.checked);
                  }}
                  style={{
                    display: "none"
                  }}
                />
                🌳
              </label>
              <label
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: showDebugParks ? "#2ecc40" : "#eee",
                  color: showDebugParks ? "#fff" : "#888",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: showDebugParks ? "0 2px 8px rgba(0,0,0,0.12)" : "none",
                  border: "2px solid #007bff",
                  transition: "background 0.2s, color 0.2s"
                }}
                title="Show Parks"
                onClick={e => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={showDebugParks}
                  onChange={e => {
                    e.stopPropagation();
                    setShowDebugParks(e.target.checked);
                  }}
                  style={{
                    display: "none"
                  }}
                />
                🏞️
              </label>
            </div>
          </div>
        )}
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


        {/* Route Polylines */}
        {routeGeometry && !greenRouteMode && (
          <>
            {console.log("Rendering normal route:", routeGeometry)}
            <Polyline
              positions={routeGeometry}
              color="#007bff"
              weight={5}
              opacity={0.8}
            />
          </>
        )}
        
        {/* Base Route (grau, durchsichtig) bei Green Route */}
        {baseRouteGeometry && greenRouteMode && (
          <>
            {console.log("Rendering base route (comparison):", baseRouteGeometry)}
            <Polyline
              positions={baseRouteGeometry}
              color="#6c757d"
              weight={3}
              opacity={0.4}
              dashArray="5, 10"
            />
          </>
        )}
        
        {/* Green Route Polyline */}
        {greenRouteGeometry && greenRouteMode && (
          <>
            {console.log("🌳 RENDERING green route with", greenRouteGeometry.length, "points, greenRouteMode:", greenRouteMode)}
            <Polyline
              positions={greenRouteGeometry}
              color="#28a745"
              weight={5}
              opacity={0.9}
            />
          </>
        )}
        
        {/* Debug: Log wenn grüne Route nicht angezeigt wird */}
        {greenRouteMode && !greenRouteGeometry && console.log("⚠️ Green route mode active but no greenRouteGeometry!")}
        {!greenRouteMode && greenRouteGeometry && console.log("ℹ️ Green route data exists but mode is off")}

        {/* Debug Trees - Support für MultiPolygon */}
        {showDebugTrees && debugTrees.map((tree, index) => {
          if (tree.geometry) {
            let polygonCoordinates = [];

            if (tree.geometry.type === 'Polygon') {
              // keep all rings (outer + holes)
              polygonCoordinates = tree.geometry.coordinates;
            } else if (tree.geometry.type === 'MultiPolygon') {
              // MultiPolygon: use first polygon, keep all its rings
              polygonCoordinates = tree.geometry.coordinates[0];
            }

            if (polygonCoordinates.length > 0) {
              // GeoJSON is [lng, lat], Leaflet needs [lat, lng]
              const coords = polygonCoordinates.map(ring =>
                ring.map(coord => [coord[1], coord[0]])
              );

              // Debug: show first coordinate in console
              if (index === 0) {
                console.log(`Tree ${index}:`, tree.geometry.type, 'coords:', coords[0][0]);
              }

              return (
                <Polygon
                  key={`tree-${index}`}
                  positions={coords}
                  color="#105b01ff"
                  fillColor="#0cac0cff"
                  fillOpacity={0.5}
                  weight={2}
                >
                  <Popup>
                    🌳 Baum #{index + 1}<br/>
                    Type: {tree.geometry.type}<br/>
                    Lat: {coords[0]?.[0]?.[0]?.toFixed(6)}<br/>
                    Lng: {coords[0]?.[0]?.[1]?.toFixed(6)}
                  </Popup>
                </Polygon>
              );
            }
          }
          return null;
        })}


       {/* Debug Parks - Support für MultiPolygon */}
{showDebugParks && debugParks.map((park, index) => {
  if (park.geometry) {
    let polygonCoordinates = [];

    if (park.geometry.type === 'Polygon') {
      // keep all rings (outer + holes)
      polygonCoordinates = park.geometry.coordinates;
    } else if (park.geometry.type === 'MultiPolygon') {
      // MultiPolygon: use first polygon, keep all its rings
      polygonCoordinates = park.geometry.coordinates[0];
    }

    if (polygonCoordinates.length > 0) {
      // GeoJSON is [lng, lat], Leaflet needs [lat, lng]
      const coords = polygonCoordinates.map(ring =>
        ring.map(coord => [coord[1], coord[0]])
      );

      // Debug: show first coordinate in console
      if (index === 0) {
        console.log(`Park ${index}:`, park.geometry.type, 'coords:', coords[0][0]);
      }

      return (
        <Polygon
          key={`park-${index}`}
          positions={coords}
          color="#0000FF"
          fillColor="#ADD8E6"
          fillOpacity={0.5}
          weight={2}
        >
          <Popup>
            🏞️ Park #{index + 1}<br/>
            Type: {park.geometry.type}<br/>
            Lat: {coords[0]?.[0]?.[0]?.toFixed(6)}<br/>
            Lng: {coords[0]?.[0]?.[1]?.toFixed(6)}
          </Popup>
        </Polygon>
      );
    }
  }
  return null;
})}


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
                width:12px;
                height:12px;
                display:flex;
                align-items:center;
                justify-content:center;
                font-weight:bold;
              "></div>`,
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