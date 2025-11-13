import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

export default function Map() {
  const mapContainer = useRef(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    new maplibregl.Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-2.24, 53.48], // Manchester
      zoom: 11,
    });
  }, []);

  return (
    <div
      ref={mapContainer}
      className="h-[600px] w-full rounded-xl shadow"
    />
  );
}
