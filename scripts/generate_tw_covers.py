"""
teddy-website 封面圖台灣風格重生 — Imagen 4 Fast 批量生圖
33 張 × $0.02 = $0.66，替換 public/covers/ 底下所有「外國感」AI 生圖

用法：python generate_tw_covers.py
前置：.env 含 GOOGLE_APPLICATION_CREDENTIALS + GOOGLE_CLOUD_PROJECT
"""
import os, sys, json, shutil, time
from pathlib import Path
from datetime import datetime

# ============================================================
# Load .env
# ============================================================
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

COVERS_DIR = Path(r"C:\Users\a0920\teddy-website\public\covers")
BACKUP_DIR = COVERS_DIR / "_backup_originals"
BACKUP_DIR.mkdir(exist_ok=True)

# ============================================================
# 共用元素
# ============================================================
TW_STYLE = (
    "Photorealistic professional photography, 16:9 landscape composition, "
    "sharp detail, natural color grading, warm subtropical lighting. "
    "East Asian metropolitan residential context, modern urban Taiwan atmosphere."
)

NEGATIVE = (
    "Western suburban house, European architecture, American interior, Mediterranean style, "
    "Scandinavian minimalist, Japanese traditional tatami, mainland China style, "
    "cartoon, 3D render, illustration, anime, video game, "
    "blurry, low quality, overexposed, underexposed, "
    "readable text, watermark, logo, brand name, "
    "identifiable human faces, recognizable people, "
    "dystopian, futuristic, fantasy, surreal, neon"
)

# ============================================================
# 33 張封面 prompt 設計 — 台灣在地風格
# ============================================================
COVERS = [
    # ── Group 1: 議價 negotiation ──
    (
        "negotiation-handshake.png",
        "Close-up of a professional handshake above a modern office desk. "
        "On the desk: printed property contract papers with Chinese characters, a Casio calculator, "
        "a ballpoint pen, and two small ceramic tea cups. Background shows a modern real estate office "
        "with glass partitions and warm fluorescent lighting. Shallow depth of field on the handshake. "
        "No visible faces, only hands and forearms in business attire. " + TW_STYLE
    ),
    (
        "negotiation-calculator.png",
        "Top-down flat lay of a real estate negotiation desk. A scientific calculator showing numbers, "
        "property listing printouts with Chinese text headers, a red stamp pad with a personal seal (印章), "
        "a smartphone, and two ceramic tea cups on a light oak veneer desk. "
        "Clean organized workspace, warm window light from the left. " + TW_STYLE
    ),
    (
        "negotiation-desk.png",
        "A tidy real estate agent's desk in a modern Taiwanese office. Manila folders labeled with "
        "Chinese tabs, a laptop showing a property listing website, business card holder, potted succulent, "
        "and a desk phone. Glass partition wall behind, another agent visible blurred in background. "
        "Clean professional atmosphere with fluorescent and natural mixed lighting. " + TW_STYLE
    ),
    (
        "negotiation-talk.png",
        "A bright modern meeting area in a Taiwanese real estate office. Two comfortable chairs facing "
        "each other across a low coffee table with property brochures and a tablet. Large window showing "
        "a dense urban skyline of apartment towers outside. Warm afternoon light, professional yet "
        "welcoming atmosphere. No people visible, just the setting ready for consultation. " + TW_STYLE
    ),
    (
        "negotiation-strategy.png",
        "A whiteboard in a real estate office covered with market data — hand-drawn bar charts, "
        "district names in Chinese characters, price range arrows, and colored sticky notes. "
        "A printed area map pinned to the board. Office desk with laptop in foreground, slightly blurred. "
        "Bright office lighting, productive work atmosphere. " + TW_STYLE
    ),

    # ── Group 2: 新青安 new-housing-loan ──
    (
        "new-housing-loan-family.png",
        "A pair of house keys with a small house-shaped keychain lying on top of a signed property "
        "purchase contract with Chinese text. Background shows the bright lobby of a modern Taiwanese "
        "apartment building with marble floor, glass doors, and a security guard desk. "
        "Warm celebratory feeling, soft natural light from the entrance. " + TW_STYLE
    ),
    (
        "new-housing-loan-keys.png",
        "Close-up of a hand holding a set of new apartment keys against a blurred background of a "
        "modern Taiwanese residential building corridor — terrazzo floor, numbered doors, fire "
        "extinguisher on the wall, elevator lobby visible. Warm overhead lighting. "
        "Only the hand is visible, no face. Feeling of new beginnings. " + TW_STYLE
    ),
    (
        "new-housing-loan-calc.png",
        "A mortgage calculation scene on a clean desk. A calculator, a printed amortization schedule "
        "with Chinese column headers (月繳金額, 本金, 利息), a bank brochure, and a pen. "
        "A laptop screen in the background shows a banking website. Warm desk lamp light, "
        "quiet focused atmosphere of financial planning. " + TW_STYLE
    ),

    # ── Group 3: 嫌惡設施 undesirable ──
    (
        "undesirable-warning.png",
        "A yellow triangular warning sign on a chain-link fence in a Taiwanese urban area. "
        "Behind the fence: a power substation (變電所) with metal structures and electrical equipment. "
        "Residential apartment towers visible in the background. Overcast sky, slightly desaturated "
        "atmosphere conveying caution. Urban infrastructure mixed with residential. " + TW_STYLE
    ),
    (
        "undesirable-surroundings.png",
        "A Taiwanese residential neighborhood street showing mixed-use buildings: a gas station "
        "next to a row of apartment buildings, with a small temple (土地公廟) visible on the corner. "
        "Scooters parked along the curb, betel nut palm trees. Late afternoon light, "
        "realistic urban Taiwan streetscape showing proximity of residential to commercial uses. " + TW_STYLE
    ),
    (
        "undesirable-distance.png",
        "Aerial drone view of a Taiwanese residential district from about 200 meters altitude. "
        "Dense cluster of apartment towers (12-20 stories) with tile facades, a major road cutting "
        "through, a school campus with running track, and a factory area with metal roofs on the edge. "
        "Late afternoon golden light, slight atmospheric haze. Showing spatial relationships "
        "between residential and various facility types. " + TW_STYLE
    ),
    (
        "undesirable-checklist.png",
        "A clipboard with a printed checklist in Chinese (嫌惡設施檢查表) being held by a hand. "
        "Some items checked with a pen. Background is blurred but shows a Taiwanese apartment "
        "building entrance with motorcycle parking area. Practical inspection feeling, "
        "professional real estate due diligence atmosphere. " + TW_STYLE
    ),
    (
        "undesirable-overview.png",
        "Wide panoramic view of a Taiwanese city skyline at golden hour. Dense residential towers "
        "with tile and glass facades, a major elevated highway (快速道路), commercial buildings with "
        "LED signage, green mountains in the far background. Warm golden light, slight haze, "
        "realistic urban density of a medium-large Taiwanese city. " + TW_STYLE
    ),

    # ── Group 4: 不動產說明書 disclosure ──
    (
        "disclosure-document.png",
        "Close-up of a printed real estate disclosure document (不動產說明書) on a desk. "
        "Multiple pages with Chinese text, diagrams of floor plans, and highlighted sections. "
        "A magnifying glass resting on the document, a pen, and sticky note tabs marking key pages. "
        "Professional office desk, warm reading lamp light. " + TW_STYLE
    ),
    (
        "disclosure-stamp.png",
        "A traditional Chinese personal seal (印章) in dark stone placed next to a red ink pad (印泥) "
        "on top of official property documents with Chinese text. Red seal impressions visible on "
        "the paper. A formal signing atmosphere, dark wood desk surface, warm focused lighting. " + TW_STYLE
    ),
    (
        "disclosure-law.png",
        "A stack of real estate law reference books with Chinese spine text on a desk next to "
        "printed property documents and a laptop showing a government website. Reading glasses "
        "resting on the open book. Study atmosphere, warm desk lamp, bookshelves blurred behind. " + TW_STYLE
    ),
    (
        "disclosure-signing.png",
        "A contract signing scene at a real estate office desk. Two copies of a contract with "
        "Chinese text, a pen mid-signature (hand visible, no face), a personal seal and red ink pad "
        "ready beside. Two cups of hot tea, a business card on the table. "
        "Professional Taiwanese office setting with warm lighting. " + TW_STYLE
    ),
    (
        "disclosure-review.png",
        "Hands flipping through a thick property disclosure document (不動產說明書). "
        "The pages show property diagrams, legal text in Chinese, and highlighted clauses. "
        "A notebook with handwritten notes open beside it. Desk lamp light, "
        "careful review atmosphere, no face visible. " + TW_STYLE
    ),

    # ── Group 5: 看屋 viewing ──
    (
        "viewing-flashlight.png",
        "A hand holding a bright LED flashlight inspecting the ceiling corner of a Taiwanese "
        "apartment. Concrete corner joint visible, white painted walls, a small crack being examined. "
        "The room is an empty apartment with tile floor (磁磚地板) and aluminum window frame visible. "
        "Professional home inspection feeling, practical and technical. " + TW_STYLE
    ),
    (
        "viewing-floorplan.png",
        "A printed architectural floor plan of a typical Taiwanese 3-bedroom apartment spread out "
        "on a table. The plan shows labeled rooms in Chinese (客廳, 主臥, 廚房, 陽台). "
        "A ruler, a red pen with circled notes, and a smartphone beside it. "
        "Planning and comparison atmosphere, bright overhead light. " + TW_STYLE
    ),
    (
        "viewing-corner.png",
        "Interior corner of a modern Taiwanese apartment living room. Ceramic tile floor with "
        "wood-grain pattern, white walls, aluminum-frame sliding glass door leading to a small balcony "
        "with potted plants. An air conditioning unit mounted on the upper wall. "
        "Natural afternoon light coming through the balcony door. Empty and clean, ready for viewing. " + TW_STYLE
    ),
    (
        "viewing-checklist.png",
        "A person's hand holding a printed viewing checklist (看屋注意事項) on a clipboard at an "
        "apartment doorway. The doorway shows a typical Taiwanese apartment entrance with shoe cabinet "
        "area and tile flooring. Pen in hand, ready to check items. Only hand visible, no face. "
        "Practical house-hunting atmosphere. " + TW_STYLE
    ),
    (
        "viewing-natural-light.png",
        "A bright empty Taiwanese apartment living room with excellent natural light. Large sliding "
        "glass windows with aluminum frames, ceramic tile floor with subtle pattern, white plastered "
        "walls, recessed ceiling with downlights (not turned on). View through the window shows "
        "neighboring apartment towers and subtropical trees. Clean, airy, newly renovated feeling. " + TW_STYLE
    ),

    # ── Group 6: 過戶 transfer ──
    (
        "transfer-document.png",
        "Close-up of official land registration transfer documents (土地登記申請書) with Chinese text "
        "on a desk at a government office. Multiple copies with official headers, a numbered queue "
        "ticket, and a folder. Functional government office atmosphere, fluorescent lighting. " + TW_STYLE
    ),
    (
        "transfer-stamp.png",
        "An official government stamp (公章) being pressed onto a property ownership certificate. "
        "The document shows Chinese text with an official red rectangular seal impression. "
        "Formal government desk, document trays and folders in background. " + TW_STYLE
    ),
    (
        "transfer-calculator.png",
        "A tax calculation workspace: calculator, printed tax computation sheet with Chinese column "
        "headers (契稅, 土地增值稅, 印花稅), a receipt, and a pen. Clean desk in a professional "
        "office setting, representing the financial side of property transfer. " + TW_STYLE
    ),
    (
        "transfer-tax.png",
        "A stack of official tax notices and payment receipts on a desk. The top document shows "
        "a tax assessment form with Chinese headers and stamped amounts. A payment receipt from a "
        "convenience store (超商代收) clipped to it. Realistic paperwork scene. " + TW_STYLE
    ),
    (
        "transfer-process.png",
        "Interior of a Taiwanese government land office (地政事務所) counter area. Number display "
        "board on the wall, service counters with glass partitions, waiting area chairs visible. "
        "A few people waiting (shown from behind, no faces). Bright fluorescent lighting, "
        "clean functional government building interior. " + TW_STYLE
    ),

    # ── Group 7: 社區 community ──
    (
        "community-balcony.png",
        "View from inside a Taiwanese apartment balcony looking outward. Aluminum-frame sliding door "
        "opened, small tiled balcony floor with potted plants (orchids and snake plants), a drying rack "
        "folded against the wall. View shows neighboring residential towers with tile facades and "
        "rooftop water tanks, subtropical trees below. Warm afternoon light, lived-in comfortable "
        "atmosphere of a typical Taiwan mid-rise apartment. " + TW_STYLE
    ),
    (
        "community-livingroom.png",
        "A modern Taiwanese apartment living room, recently renovated. Wood-grain porcelain tile floor, "
        "recessed LED ceiling lights, a comfortable L-shaped sofa, flat-screen TV on a sleek media wall, "
        "air conditioning unit above. Large aluminum-frame windows showing city view. "
        "Clean modern interior that feels distinctly Taiwanese mid-range residential. " + TW_STYLE
    ),
    (
        "community-streetview.png",
        "A tree-lined residential street in a Taiwanese urban district. Modern 12-15 story apartment "
        "buildings with tile facades on both sides, covered walkway (騎樓) at ground level, "
        "scooters parked neatly, a convenience store sign partially visible, tropical street trees "
        "(camphor or banyan). Late afternoon warm light, clean and well-maintained neighborhood. " + TW_STYLE
    ),
    (
        "community-architecture.png",
        "Exterior of a modern Taiwanese residential tower complex, approximately 20 stories. "
        "Clean geometric facade with stone veneer and glass curtain wall sections, ground floor "
        "lobby entrance with glass canopy, landscaped entrance garden with tropical plants. "
        "Blue sky with white clouds, warm daylight. Premium but realistic Taiwanese residential "
        "architecture, not luxury resort style. " + TW_STYLE
    ),
    (
        "community-garden.png",
        "Community courtyard garden of a Taiwanese residential complex. Paved walking path with "
        "interlocking bricks, tropical landscaping (palm trees, bird of paradise, ferns), a small "
        "gazebo with benches, children's playground equipment visible in the distance. "
        "Tower buildings surrounding the courtyard, warm morning light. Well-maintained common area "
        "of a mid-to-high-end Taiwanese apartment community. " + TW_STYLE
    ),
]

# ============================================================
# Init Vertex AI client
# ============================================================
print(f"[init] project={PROJECT_ID} location={LOCATION} model={MODEL}")
try:
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    print("[OK] Vertex AI client ready")
except Exception as e:
    sys.exit(f"[FATAL] Vertex AI init failed: {e}")

# ============================================================
# Generate loop
# ============================================================
timestamp = datetime.now().strftime("%Y%m%d_%H%M")
results = []
total = len(COVERS)

for i, (filename, prompt) in enumerate(COVERS, 1):
    print(f"\n[{i}/{total}] {filename}")
    target = COVERS_DIR / filename

    # Backup original
    if target.exists():
        backup = BACKUP_DIR / filename
        if not backup.exists():
            shutil.copy2(target, backup)
            print(f"  [backup] → {backup.name}")

    # Generate
    for attempt in range(3):
        try:
            cfg = types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="16:9",
                safety_filter_level="BLOCK_ONLY_HIGH",
                person_generation="ALLOW_ADULT",
                negative_prompt=NEGATIVE,
            )
            response = client.models.generate_images(
                model=MODEL, prompt=prompt, config=cfg,
            )
            img_bytes = response.generated_images[0].image.image_bytes
            target.write_bytes(img_bytes)
            size_kb = len(img_bytes) / 1024
            print(f"  [OK] {size_kb:.0f} KB")
            results.append((filename, "OK", f"{size_kb:.0f} KB"))
            break
        except Exception as e:
            err = str(e)[:200]
            print(f"  [attempt {attempt+1}/3 FAIL] {err}")
            if attempt < 2:
                time.sleep(2)
            else:
                results.append((filename, "FAIL", err))

    # Rate limit: 1 sec between calls
    if i < total:
        time.sleep(1)

# ============================================================
# Summary
# ============================================================
ok_count = sum(1 for _, s, _ in results if s == "OK")
fail_count = sum(1 for _, s, _ in results if s == "FAIL")

print("\n" + "=" * 60)
print(f"完成！成功 {ok_count}/{total}，失敗 {fail_count}")
print(f"備份在: {BACKUP_DIR}")
print(f"輸出在: {COVERS_DIR}")
if fail_count:
    print("\n失敗清單:")
    for fn, s, info in results:
        if s == "FAIL":
            print(f"  ❌ {fn}: {info[:100]}")
print("=" * 60)
