from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncpg
import os
import json
import logging
from contextlib import asynccontextmanager

# Setup logging to help us see errors in the console
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:uomdiss1131@takewalk_db:5432/takewalk")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        app.state.pool = await asyncpg.create_pool(DATABASE_URL)
        logger.info("Database connection pool created.")
        yield
    finally:
        await app.state.pool.close()
        logger.info("Database connection pool closed.")

app = FastAPI(title="Take Me For A Walk API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RouteRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float

@app.get("/")
def read_root():
    return {"message": "Routing Backend is Active"}

# We use /route to match your Next.js rewrite rule
@app.post("/route")
async def get_route(request: RouteRequest):
    try:
        async with app.state.pool.acquire() as conn:
            # 1. SNAP
            snap_query = """
                SELECT id FROM walkable_ways_noded_vertices_pgr 
                ORDER BY the_geom <-> ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857)
                LIMIT 1;
            """
            start_node = await conn.fetchval(snap_query, request.start_lon, request.start_lat)
            end_node = await conn.fetchval(snap_query, request.end_lon, request.end_lat)

            if start_node is None or end_node is None:
                raise HTTPException(status_code=404, detail="Could not snap to walkable network.")
            if start_node == end_node:
                return {"type": "FeatureCollection", "features": [], "metadata": {"distance_m": 0, "duration_min": 0}}

            # 2. ROUTE + STATS (Combined Query)
            # We calculate ST_Length in 3857 (meters) for accuracy.
            pgr_query = f"""
                WITH route_geom AS (
                    SELECT ST_LineMerge(ST_Collect(b.geom ORDER BY a.seq)) as geom
                    FROM pgr_dijkstra(
                        'SELECT id, source, target, ST_Length(geom) as cost, ST_Length(geom) as reverse_cost 
                         FROM walkable_ways_noded 
                         WHERE geom && ST_Expand(ST_Envelope(ST_Collect(
                            (SELECT the_geom FROM walkable_ways_noded_vertices_pgr WHERE id = {start_node}),
                            (SELECT the_geom FROM walkable_ways_noded_vertices_pgr WHERE id = {end_node})
                         )), 20000)',
                        {start_node}, 
                        {end_node}, 
                        false 
                    ) a
                    JOIN walkable_ways_noded b ON a.edge = b.id
                )
                SELECT 
                    ST_AsGeoJSON(ST_Transform(geom, 4326)) as geojson,
                    ST_Length(geom) as length_meters
                FROM route_geom;
            """
            
            row = await conn.fetchrow(pgr_query)
            
            if not row or not row['geojson']:
                raise HTTPException(status_code=404, detail="No route found.")

            # Based on the paper: 200m takes ~2.5 mins [cite: 98]
            # Speed = 200m / 150s = 1.33 m/s (~4.8 km/h)
            # Currently, flat speed assumption for walking.
            distance_m = row['length_meters']
            duration_min = (distance_m / 1.33) / 60

            return {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": json.loads(row['geojson']),
                        "properties": {"name": "Walking Route"}
                    }
                ],
                "metadata": {
                    "distance_m": round(distance_m, 1),
                    "duration_min": round(duration_min, 1)
                }
            }
    except Exception as e:
        logger.error(f"Backend Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))