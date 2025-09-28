import { useState, useEffect} from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, ZoomControl, GeoJSON } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';



/* ---- Typen (Emoji + Color) ---- */
const TYPES = [
  { value: "Drinking fountain", emoji: "💧", color: "#0ea5e9" },
  { value: "Bench", emoji: "🪑", color: "#a25900ff" },
  { value: "Park", emoji: "🌳", color: "#169d47" },
  { value: "Fountain", emoji: "⛲", color: "#0749b2ff" },
  { value: "Picnic table", emoji: "🍽️", color: "#ff7300ff" },
  { value: "Water playground", emoji: "🏖️", color: "#d40606ff" },
];




/* ---- Klick-Handler: merkt Position für Formular ---- */
function ClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
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
              e.stopPropagation();   // ← add this
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
  const [activeTypes, setActiveTypes] = useState(TYPES.map(t => t.value));
  const [districts, setDistricts] = useState([]);

  /* Filter */
  function toggleType(type) {
  setActiveTypes((prev) =>
    prev.includes(type)
      ? prev.filter((t) => t !== type) // remove if already active
      : [...prev, type]                // add if not active
  );
  } 

  /* ---- District load ---- */
  useEffect(() => {
  fetch("http://localhost:8000/districts")
    .then((res) => res.json())
    .then(setDistricts);
}, []);

  /* ---- Load ---- */
  useEffect(() => {
    fetch("http://localhost:8000/features")
      .then((res) => res.json())
      .then((data) => {
        const casted = data.map((d) => ({
          ...d,
          id: d.id,                     // ID sicher übernehmen
          lat: Number(d.lat),
          lng: Number(d.lng),
          type: d.type || d.name,       // falls Backend nur name gesetzt hat
        }));
        console.log("Fetched markers:", casted.length, casted[0]);
        setMarkers(casted);
      })
      .catch((e) => console.error("GET /features failed:", e));
  }, []);

  /* ---- Save ---- */
  function handleAdd(marker) {
  fetch("http://localhost:8000/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(marker),
  })
    .then((res) => res.json())
    .then((data) => {
      setMarkers((m) => [...m, { ...marker, id: data.id }]); // ← ID setzen
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
      // Option A: remove immediately locally
      // setMarkers((m) => m.filter((x) => x.id !== id));
      // Option B (recommended): reload directly to always get “truth from DB”
      return fetch("http://localhost:8000/features").then((r) => r.json());
    })
    .then((fresh) => fresh && setMarkers(fresh))
    .catch((e) => console.error("DELETE failed:", e));
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
    > {/* 
      <button
        onClick={() =>
          fetch("http://localhost:8000/features")
            .then((r) => r.json())
            .then(setMarkers)
        }
      >
        🔄 Neu laden
      </button>
      */}

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
      <ClickHandler onClick={(pos) => setNewPosition(pos)} />
      

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
        width:10px;
        height:10px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:bold;
      "></div>`,
      className: "custom-cluster",
      iconSize: [32, 32],
    });
  }}>
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
            //stroke: false 
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
      {newPosition && (
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
