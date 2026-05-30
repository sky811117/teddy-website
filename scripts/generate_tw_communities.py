"""
communities/ 15 張社區圖台灣寫實風重生
從「3D arch viz / 水彩 / 大陸透視圖」風格換成「台灣寫實住宅攝影」
檔名保留（未來引用不會壞）
"""
import os, sys, shutil, time
from pathlib import Path

ENV_PATH = Path(r"C:\Users\a0920\房仲工作站\.env")
for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip('"').strip("'")

from google import genai
from google.genai import types

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "teddy-dev-496302")
LOCATION = "us-central1"
MODEL = "imagen-4.0-fast-generate-001"

DIR = Path(r"C:\Users\a0920\teddy-website\public\communities")
BACKUP = DIR / "_backup_originals"
BACKUP.mkdir(exist_ok=True)

TW_REALIST = (
    "Photorealistic professional architectural photography, sharp detail, natural color, "
    "warm subtropical Taiwanese urban atmosphere. "
    "Building facades feature realistic Taiwanese mid-to-high-rise residential characteristics: "
    "tile cladding with stone-like patterns, aluminum-frame windows, balcony railings, "
    "rooftop water tanks and air conditioning condensers visible. "
    "Surrounding context shows typical Taiwan residential street: covered walkway (騎樓), "
    "scooters parked along curbs, tropical street trees (camphor, banyan, palm), "
    "neighboring buildings with mixed ages. "
    "Lighting: warm late afternoon golden hour, natural sky with some clouds, slight atmospheric haze. "
    "16:9 landscape composition. No readable signage text, no recognizable people."
)

NEG = (
    "3D render look, architectural visualization style, watercolor illustration, "
    "ink wash painting, white background isolation, perspective drawing, "
    "mainland China architecture, generic Asian style, "
    "Western suburban house, European facade, Mediterranean, Japanese tatami, "
    "perfect manicured lawn, fantasy resort, futuristic, neon, "
    "cartoon, anime, video game, blurry, low quality, "
    "readable Chinese text, visible brand names, watermarks"
)

# ============================================================
# 15 張 community prompt — 從檔名抓 hint，套上台灣寫實風
# ============================================================
COMMUNITIES = [
    ("chunfu-xingbo.png",
     "A pair of two symmetrical 22-story residential towers in Taichung urban district. "
     "Tile and stone facade with rhythmic balcony pattern. Modern landscaped pedestrian entry between them. "
     "Photographed from across a 6-lane boulevard."),

    ("city-classic.png",
     "A single 15-story classic-design residential tower in a busy Taichung commercial-residential mixed district. "
     "Beige stone-tile facade with vertical fluted details. Street-level retail shops below. "
     "Mature street trees, scooters in foreground."),

    ("farglory-happiness.png",
     "Wide aerial view of a large Taichung residential complex of 4 towers (18-22 stories) "
     "arranged around a central landscaped courtyard with walking paths and small water feature. "
     "Late afternoon golden light, surrounding city blocks visible."),

    ("fuyu-world.png",
     "Two parallel rows of 5-story modern dark-charcoal facade townhouse-style apartment buildings "
     "in a quiet Taichung residential lane. Aluminum-frame windows with horizontal balconies. "
     "Mature street trees, paved sidewalk."),

    ("hollywood-mansion.png",
     "A single 14-story upscale residential tower in central Taichung. "
     "Stone cladding base with curtain-wall upper floors. Lobby entrance with glass canopy. "
     "Daytime, surrounded by mature urban trees, modest commercial street."),

    ("huangpu-manor.png",
     "A single elegant 12-story residential tower in suburban Taichung redevelopment district. "
     "Curved corner balconies, beige limestone-pattern tile facade. "
     "Wide street with bike lane, landscaped median strip."),

    ("lianyue-zhen.png",
     "Large-scale residential complex viewed from street level: long row of "
     "8-12 story apartment buildings with tile facades in Taichung. "
     "Mid-rise scale, well-maintained sidewalk with covered walkway."),

    ("liyuandao.png",
     "A pleasant 10-story mid-range residential building in a Taichung neighborhood, "
     "with tile facade and balconies displaying potted plants. "
     "Foreground: a few scooters parked on the curb, tree-lined sidewalk, sunny weather."),

    ("mantingfang.png",
     "View of a courtyard-style residential community in Taichung: 6-story mid-rise buildings "
     "surround a central garden plaza with paved paths, planters, and benches. "
     "Warm afternoon light, peaceful residential atmosphere."),

    ("meili-dian.png",
     "A premium 20-story residential tower in Taichung Xitun district. "
     "Cross-shaped floor plan with beige stone facade and recessed balconies. "
     "Surrounded by lower neighboring buildings, urban park edge visible."),

    ("shengxing-fengjing.png",
     "Two symmetrical 18-story residential towers in Taichung facing each other across "
     "a landscaped boulevard with central tree-lined median. "
     "Light beige tile facade with vertical accent strips."),

    ("smile-century-yunpin.png",
     "A mid-rise 12-story residential apartment building with light cream tile facade in Taichung. "
     "Visible in the background: an elevated highway and the surrounding mid-density urban fabric. "
     "Foreground shows neighborhood street with mature trees."),

    ("xingfufa-dreamcity.png",
     "Two tall 25-story twin towers in Taichung's new redevelopment district, "
     "shot at blue hour. Glass curtain wall with bronze accents, warm interior window lights. "
     "Pedestrian plaza with landscape lighting at the base."),

    ("zongtai-2020.png",
     "Aerial view of a very large Taichung residential community: multiple 14-18 story buildings "
     "spread across a landscaped site with central garden, swimming pool, walking paths, "
     "and amenity buildings. Late afternoon golden light, distant city skyline."),

    ("zongtai-heart.png",
     "Two iconic 28-story residential towers in central Taichung at blue hour. "
     "Premium architecture with glass curtain wall and stone facade base. "
     "City boulevard with light trails from passing cars, illuminated building edges, "
     "warm interior lights from apartment windows."),
]

print(f"[init] {MODEL} @ {PROJECT_ID}/{LOCATION}")
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
print("[OK] Vertex AI ready\n")

results = []
for i, (fn, hint) in enumerate(COMMUNITIES, 1):
    target = DIR / fn
    print(f"[{i}/15] {fn}")
    if target.exists():
        bk = BACKUP / fn
        if not bk.exists():
            shutil.copy2(target, bk)
            print(f"  backup -> {bk.name}")

    prompt = hint + " " + TW_REALIST

    for attempt in range(3):
        try:
            cfg = types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="16:9",
                safety_filter_level="BLOCK_ONLY_HIGH",
                person_generation="ALLOW_ADULT",
                negative_prompt=NEG,
            )
            r = client.models.generate_images(model=MODEL, prompt=prompt, config=cfg)
            img = r.generated_images[0].image.image_bytes
            target.write_bytes(img)
            print(f"  [OK] {len(img)/1024:.0f} KB")
            results.append((fn, "OK"))
            break
        except Exception as e:
            err = str(e)[:200]
            print(f"  [{attempt+1}/3 FAIL] {err}")
            if attempt < 2:
                time.sleep(2)
            else:
                results.append((fn, "FAIL"))
    if i < 15:
        time.sleep(1)

ok = sum(1 for _, s in results if s == "OK")
print(f"\n=== 完成 {ok}/15 ===")
for fn, s in results:
    print(f"  [{s}] {fn}")
