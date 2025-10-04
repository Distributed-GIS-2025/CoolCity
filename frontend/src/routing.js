// Routing utilities für Valhalla
export function decodePolyline(encoded) {
  const poly = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;
  
  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    
    poly.push([lat / 1e5, lng / 1e5]);
  }
  
  return poly;
}

export async function calculateRoute(points, routingType = 'pedestrian') {
  const payload = {
    points: points.map(p => [p.lng, p.lat]), // [lon, lat] für Backend
    costing: routingType
  };
  
  const response = await fetch("http://localhost:8000/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  const data = await response.json();
  
  if (data.trip && data.trip.legs && data.trip.legs[0]) {
    const leg = data.trip.legs[0];
    const coords = decodePolyline(leg.shape);
    return {
      geometry: coords,
      info: {
        distance: leg.summary.length.toFixed(2),
        time: Math.round(leg.summary.time / 60),
        unit: leg.summary.units || 'km'
      }
    };
  }
  
  throw new Error('No route found');
}