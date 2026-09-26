"""Turn phone photos into eval samples: upright, 768 px, JPEG q70, no metadata (no GPS).

  server/.venv/bin/pip install pillow pillow-heif        # one time
  server/.venv/bin/python samples/prepare_photos.py ~/Downloads/IMG_1234.HEIC person_left
  server/.venv/bin/python samples/prepare_photos.py ~/Downloads/IMG_1235.HEIC bins --crop 0 0 0.8 1

--crop takes left top right bottom as fractions of the upright photo (0 0 1 1 = no crop).
Crop out faces and anyone who isn't a teammate.
"""
import argparse
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()
OUT = Path(__file__).resolve().parent

parser = argparse.ArgumentParser()
parser.add_argument("photo", type=Path)
parser.add_argument("name", help="descriptive file name, without .jpg")
parser.add_argument("--crop", nargs=4, type=float, default=[0, 0, 1, 1], metavar=("L", "T", "R", "B"))
args = parser.parse_args()

im = ImageOps.exif_transpose(Image.open(args.photo)).convert("RGB")  # apply the iPhone's rotation flag
w, h = im.size
left, top, right, bottom = args.crop
im = im.crop((int(left * w), int(top * h), int(right * w), int(bottom * h)))
im.thumbnail((768, 768))
out = OUT / f"{args.name}.jpg"
im.save(out, "JPEG", quality=70, optimize=True)  # saved without EXIF, so no GPS
print(f"{out.relative_to(OUT.parent)} {im.size[0]}x{im.size[1]}")
