import os
import base64

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
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
    api_key=os.environ["GEMINI_API_KEY"],
)

@app.get("/")
def home():
    return {"message": "Server is running"}

@app.post("/detect")
async def detect(data: dict):
    image_data = data["image"].split(",")[1]
    image_bytes = base64.b64decode(image_data)

    response = client.models.generate_content(
        model=os.environ["GEMINI_MODEL"],
        contents=[
            {
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": image_bytes,
                }
            },
            "Identify all visible objects. Output ONLY a comma-separated list of object names. No sentences, no introduction, no explanation, no punctuation other than commas.",
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=200
        )
    )

    print("Gemini response:", response)
    print("Gemini text:", response.text)

    return {"result": response.text}