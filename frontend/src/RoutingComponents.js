import { useState } from 'react';
import { Polyline, Marker, Popup } from 'react-leaflet';
import { calculateRoute } from './routing';

export function RoutingControl({ onRouteUpdate }) {
  const [routingMode, setRoutingMode] = useState(false);
  const [routingType, setRoutingType] = useState('pedestrian');

  const toggleRoutingMode = () => {
    setRoutingMode(!routingMode);
    onRouteUpdate({ 
      mode: !routingMode, 
      type: routingType,
      action: !routingMode ? 'start' : 'stop'
    });
  };

  return (
    <div style={{ borderBottom: "1px solid #eee", paddingBottom: 8, marginBottom: 8 }}>
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
        <select
          value={routingType}
          onChange={(e) => {
            setRoutingType(e.target.value);
            onRouteUpdate({ mode: routingMode, type: e.target.value, action: 'typeChange' });
          }}
          style={{ width: "100%", marginBottom: 4 }}
        >
          <option value="pedestrian">🚶 Walking</option>
          <option value="bicycle">🚴 Cycling</option>
          <option value="auto">🚗 Driving</option>
        </select>
      )}
    </div>
  );
}

export function RouteDisplay({ routeGeometry, routePoints, routeInfo, onClearRoute }) {
  return (
    <>
      {/* Route Polyline */}
      {routeGeometry && (
        <Polyline
          positions={routeGeometry}
          color="#007bff"
          weight={5}
          opacity={0.8}
        />
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

      {/* Route Info Display */}
      {routeInfo && (
        <div style={{ 
          position: 'absolute',
          top: 60,
          left: 12,
          zIndex: 1000,
          background: 'rgba(255,255,255,0.9)',
          padding: 8,
          borderRadius: 4,
          fontSize: '12px'
        }}>
          📍 {routeInfo.distance} {routeInfo.unit}<br/>
          ⏱️ {routeInfo.time} min
          <button 
            onClick={onClearRoute}
            style={{ marginLeft: 8, fontSize: '10px' }}
          >
            ❌
          </button>
        </div>
      )}
    </>
  );
}