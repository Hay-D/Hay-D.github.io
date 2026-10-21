"""Pack the catalog artwork into the scanner's ordinary image reference sheet."""
from pathlib import Path
from io import BytesIO
import json
from urllib.request import Request, urlopen
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
REFERENCES = PUBLIC / "scanner/references"


def main():
    catalog = json.loads((PUBLIC / "data/catalog.json").read_text())["items"]
    index = json.loads((REFERENCES / "index.json").read_text())
    tile, columns = 64, 16
    sheet = Image.new("RGBA", (columns * tile, ((len(catalog) + columns - 1) // columns) * tile))
    for number, item in enumerate(catalog):
        local = PUBLIC / "assets/items" / (item["id"] + ".png")
        if item["category"] == "Animal feed":
            local = PUBLIC / "assets/feeds" / (item["id"] + ".png")
        if local.exists():
            image = Image.open(local).convert("RGBA")
        else:
            request = Request(item["image"], headers={"User-Agent": "HayDex reference builder"})
            with urlopen(request, timeout=30) as response:
                image = Image.open(BytesIO(response.read())).convert("RGBA")
        box = image.getbbox()
        if box:
            image = image.crop(box)
        image.thumbnail((60, 60), Image.Resampling.LANCZOS)
        sheet.alpha_composite(image, ((number % columns) * tile + (tile - image.width) // 2, (number // columns) * tile + (tile - image.height) // 2))
    temporary = REFERENCES / "items.webp.tmp"
    sheet.save(temporary, format="WEBP", quality=90, method=6)
    temporary.replace(REFERENCES / "items.webp")
    index.update(version=1, tile=tile, columns=columns, items=[item["id"] for item in catalog])
    (REFERENCES / "index.json").write_text(json.dumps(index, separators=(",", ":")) + "\n")
    print(f"Packed {len(catalog)} item references.")


if __name__ == "__main__":
    main()
