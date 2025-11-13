from fastapi import FastAPI

app = FastAPI(title="Take Me For A Walk API")

@app.get("/")
def read_root():
    return {"message": "Backend is running!"}
