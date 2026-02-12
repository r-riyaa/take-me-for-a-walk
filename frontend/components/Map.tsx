"use client";

import React, { useState } from 'react';
import Map, { Marker, Source, Layer, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

type RouteData = {
  type: "FeatureCollection";
  features: Array<any>;
  metadata?: {
    distance_m: number;
    duration_min: number;
  };
};

export default function MapComponent() {
  const [startAddress, setStartAddress] = useState("");
  const [endAddress, setEndAddress] = useState("");
  const [startCoords, setStartCoords] = useState<[number, number] | null>(null);
  const [endCoords, setEndCoords] = useState<[number, number] | null>(null);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Geocoding (Address -> Lat/Lon)
  const geocode = async (query: string): Promise<[number, number] | null> => {
    try {
      // Bounding box for Manchester to improve accuracy
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=-2.35,53.55,-2.15,53.35&bounded=1`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data && data.length > 0) {
        return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
      }
      alert(`Could not find location: "${query}"`);
      return null;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  // 2. Routing (Lat/Lon -> Blue Line)
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setRouteData(null); 

    const start = await geocode(startAddress);
    if (!start) { setLoading(false); return; }
    setStartCoords(start);

    const end = await geocode(endAddress);
    if (!end) { setLoading(false); return; }
    setEndCoords(end);

    console.log(`Requesting route: ${start} -> ${end}`);

    try {
      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_lon: start[0],
          start_lat: start[1],
          end_lon: end[0],
          end_lat: end[1],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Backend Error:", errorData);
        throw new Error(errorData.detail || "No route found");
      }

      const data = await response.json();
      setRouteData(data);
    } catch (error) {
      console.error(error);
      alert("No route found. Try points closer to a main road.");
    }
    setLoading(false);
  };

  return (
    <div className="relative w-full h-screen">
      
      {/* SEARCH BOX */}
      <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded-lg shadow-lg w-80">
        <h2 className="text-xl font-bold mb-4 text-gray-800">Take Me For A Walk</h2>
        <form onSubmit={handleSearch} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Start (e.g. Manchester Town Hall)"
            className="p-2 border border-gray-300 rounded text-black"
            value={startAddress}
            onChange={(e) => setStartAddress(e.target.value)}
            suppressHydrationWarning={true} 
          />
          <input
            type="text"
            placeholder="End (e.g. Piccadilly Station)"
            className="p-2 border border-gray-300 rounded text-black"
            value={endAddress}
            onChange={(e) => setEndAddress(e.target.value)}
            suppressHydrationWarning={true}
          />
          <button 
            type="submit" 
            disabled={loading}
            className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            suppressHydrationWarning={true}
          >
            {loading ? "Calculating..." : "Find Route"}
          </button>
        </form>
        {/* --- INSERT LIVE STATS DASHBOARD HERE --- */}
        {routeData?.metadata && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold">Distance</p>
                <p className="text-lg font-semibold text-blue-600">
                  {(routeData.metadata.distance_m / 1000).toFixed(2)} km
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase font-bold">Est. Time</p>
                <p className="text-lg font-semibold text-blue-600">
                  {Math.round(routeData.metadata.duration_min)} mins
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MAP */}
      <Map
        initialViewState={{
          longitude: -2.2426,
          latitude: 53.4808,
          zoom: 13
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://tiles.openfreemap.org/styles/bright"
      >
        <NavigationControl position="bottom-right" />

        {/* --- MARKERS --- */}
        {startCoords && <Marker longitude={startCoords[0]} latitude={startCoords[1]} color="green" />}
        {endCoords && <Marker longitude={endCoords[0]} latitude={endCoords[1]} color="red" />}

        {/* --- 1. MAIN ROUTE (Solid Blue on the Road) --- */}
        {routeData && (
          <Source id="route-source" type="geojson" data={routeData}>
            <Layer
              id="route-layer"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                'line-color': '#3b82f6', // Bright Blue
                'line-width': 6,
                'line-opacity': 0.8
              }}
            />
          </Source>
        )}

        {/* --- 2. CONNECTOR LINES (Dashed Grey to the Doorstep) --- */}
        {routeData && startCoords && endCoords && (
          <Source
            id="connector-source"
            type="geojson"
            data={{
              type: 'FeatureCollection',
              features: [
                // Line from Start Marker -> Start of Blue Route
                {
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      startCoords, 
                      routeData.features[0].geometry.coordinates[0]
                    ]
                  },
                  properties: {}
                },
                // Line from End of Blue Route -> End Marker
                {
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      routeData.features[0].geometry.coordinates[routeData.features[0].geometry.coordinates.length - 1], 
                      endCoords
                    ]
                  },
                  properties: {}
                }
              ]
            }}
          >
            <Layer
              id="connector-layer"
              type="line"
              paint={{
                'line-color': '#555',       // Dark Grey
                'line-width': 3,
                'line-dasharray': [2, 2],   // <--- Makes it DASHED
                'line-opacity': 0.7
              }}
            />
          </Source>
        )}
      </Map>
    </div>
  );
}