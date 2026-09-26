import os
import base64

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"]
)
@app.get("/")
def home():
    return {"message": "Server is running"}

@app.post("/detect")
async def detect(data: dict):
    image_data = data["image"].split(",")[1]
    image_bytes = base64.b64decode(image_data)

    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents=[
            {
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": image_bytes,
                }
            },
            "Identify the objects in this image. Return only a simple list of objects.",
        ],
    )

    return {"result": response.text}