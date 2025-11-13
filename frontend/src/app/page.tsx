"use client";

import { useEffect } from "react";
import Map from "../../components/Map";

export default function Home() {
  useEffect(() => {
    fetch("/api")
      .then((res) => res.json())
      .then((data) => console.log("API response:", data))
      .catch((error) => console.error("API error:", error));
  }, []);

  return (
    <div className="p-10">
      <h1 className="text-4xl font-bold">Take Me For A Walk</h1>
      <p className="mt-4 text-lg">Check your console for API response!</p>

      <div className="mt-10">
        <Map />
      </div>
    </div>
  );
}
