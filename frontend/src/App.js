import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ---- Typen (Emoji + Farbe) ---- */
const TYPES = [
  { value: "Trinkbrunnen", emoji: "💧", color: "#0ea5e9" },
  { value: "Sitzbank",     emoji: "🪑", color: "#8b5cf6" },
  { value: "Kühler Ort",   emoji: "🌳", color: "#16a34a" },
];

/* ---- Icon je Typ ---- */
function iconFor(typeValue) {
  const t = TYPES.find((t) => t.value === typeValue) || TYPES[0];
  const html = `
    <span class="marker-bubble" style="background:${t.color}">
      <span class="marker-emoji">${t.emoji}</span>
    </span>
  `;
  return L.divIcon({
    className: "custom-marker",
    html,
    iconAnchor: [16, 32],
    popupAnchor: [0, -28],
  });
}

/* ---- Klick-Handler: merkt Position für Formular ---- */
function ClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/* ---- Formular-Popup beim Hinzufügen ---- */
function AddMarkerForm({ position, onAdd, onCancel }) {
  const [type, setType] = useState("Trinkbrunnen");

  function handleSubmit(e) {
    e.preventDefault();
    onAdd({ ...position, type, name: type });
  }

  return (
    <Popup position={[position.lat, position.lng]} onClose={onCancel}>3
      <form onSubmit={handleSubmit} style={{ minWidth: 180 }}>
        <label style={{ display: "block", marginBottom: 6 }}>
          Typ:
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
          <button type="button" onClick={onCancel}>Abbrechen</button>
          <button type="submit">Hinzufügen</button>
        </div>
      </form>
    </Popup>
  );
}

export default function App() {
  const [markers, setMarkers] = useState([]);
  const [newPosition, setNewPosition] = useState(null);

  /* ---- Laden ---- */
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

  /* ---- Hinzufügen ---- */
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


  /* ---- Löschen ---- */
  function handleDelete(id) {
  if (!id) return;
  fetch(`http://localhost:8000/features/${id}`, { method: "DELETE" })
    .then((res) => {
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      // Variante A: sofort lokal entfernen
      setMarkers((m) => m.filter((x) => x.id !== id));
      // Variante B (empfohlen): direkt neu laden, damit immer „Wahrheit aus DB“
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
        gap: 8,
        background: "white",
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: "6px 8px",
        boxShadow: "0 4px 16px rgba(0,0,0,.15)"
      }}
    >
      <button
        onClick={() =>
          fetch("http://localhost:8000/features")
            .then((r) => r.json())
            .then(setMarkers)
        }
      >
        🔄 Neu laden
      </button>

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
        ♻️ Reset auf OSM
      </button>
    </div>

    <MapContainer center={[52.52, 13.405]} zoom={13} scrollWheelZoom>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ClickHandler onClick={(pos) => setNewPosition(pos)} />

      {/* Marker */}
      {markers.map((m) => (
        <Marker
          key={m.id ?? `${m.lat},${m.lng}`}
          position={[m.lat, m.lng]}
          icon={iconFor(m.type || m.name)}
        >
          <Popup>
            <b>{m.name}</b>
            <div style={{ marginTop: 6 }}>
              <button type="button" onClick={() => handleDelete(m.id)}>
                ❌ Löschen
              </button>
            </div>
          </Popup>
        </Marker>
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
