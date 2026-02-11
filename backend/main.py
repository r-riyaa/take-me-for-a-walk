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
            # 1. SNAP: Find nearest nodes (Ensure we use integers)
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
                return {"type": "FeatureCollection", "features": []}

            logger.info(f"Routing: {start_node} -> {end_node}")

            # 2. ROUTE: Optimized Dijkstra
            # We use f-strings for IDs here to avoid the asyncpg type-inference error ($1 expected str)
            # because start_node/end_node are already validated integers from the DB.
            pgr_query = f"""
                SELECT ST_AsGeoJSON(ST_Transform(ST_LineMerge(ST_Collect(b.geom ORDER BY a.seq)), 4326)) 
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
                JOIN walkable_ways_noded b ON a.edge = b.id;
            """
            
            geojson_str = await conn.fetchval(pgr_query)
            
            if not geojson_str:
                raise HTTPException(status_code=404, detail="No route found between these points.")

            return {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": json.loads(geojson_str),
                        "properties": {"name": "Walking Route"}
                    }
                ]
            }
    except Exception as e:
        logger.error(f"Backend Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))