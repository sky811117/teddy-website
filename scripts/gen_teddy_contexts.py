# -*- coding: utf-8 -*-
"""
景泰 12 張情境圖 — FLUX 生背景 + 景泰本人 composite

策略：
  純 inpainting / img2img 無法保住「胸口徽章 + 綠領帶 + 不改臉」三條件
  所以走 composite 法：FLUX 生 12 張無人物情境背景，景泰原圖 rembg 去背貼上
  → 景泰本人 100% 還原（原 pixel 直出），背景 AI 生成

流程：
  1. rembg 把 teddy-portrait.jpg → teddy-portrait-cutout.png (RGBA)
  2. 12 個情境 prompt → ComfyUI FLUX-dev 跑 12 張 1080x1350 背景
  3. PIL paste 景泰人像到背景中央偏下 → contexts/teddy-context-NN.png
  4. TG 推完工通知
"""
import sys, io, time, uuid, urllib.request, urllib.parse, json, subprocess
from pathlib import Path

try:
    if sys.stdout is not None and hasattr(sys.stdout, "buffer") and sys.stdout.encoding != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except (ValueError, AttributeError):
    pass

from PIL import Image, ImageFilter

# ===================== 路徑 =====================
ROOT = Path(r"C:\Users\a0920\teddy-website")
PORTRAIT = ROOT / "public" / "photos" / "teddy-portrait.jpg"
CONTEXTS = ROOT / "public" / "photos" / "contexts"
CONTEXTS.mkdir(parents=True, exist_ok=True)
WORK = CONTEXTS / "_work"; WORK.mkdir(parents=True, exist_ok=True)
CUTOUT = WORK / "teddy-portrait-cutout.png"

# ===================== ComfyUI =====================
COMFY = "http://127.0.0.1:8188"
W, H = 1080, 1350  # 4:5

# ===================== 12 情境 prompt =====================
# 設計原則：
#   - 場景無人 (no people / empty room)，景泰人像之後 paste 在中央偏下
#   - 物件擺在側邊 / 桌面 / 牆面，不要擋到中央人像位置
#   - 自然光、寫實、不過度修圖（low contrast, soft lighting）
#   - 8/9/11/12 因景泰原圖沒手部，改用「環境感」呈現
SCENES = [
    # 1. 北歐風客廳（看屋現場）
    "Nordic scandinavian living room interior, beige walls, light oak hardwood floor, "
    "modern grey fabric sofa on the right side, indoor plants in corners, large floor-to-ceiling window "
    "with soft natural daylight streaming in, minimalist furniture, professional real estate photography, "
    "wide angle empty room view, no people, warm cozy atmosphere, low contrast soft lighting",

    # 2. 社區大樓外觀
    "Modern residential apartment complex building exterior in Taichung Taiwan, "
    "contemporary high-rise tower architecture with clean lines, lush green trees along the entrance walkway, "
    "blue sky with light clouds, bright afternoon daylight, wide angle architectural photography, "
    "no people, professional real estate exterior shot, low contrast",

    # 3. 辦公室電腦（用 AI 工具）
    "Modern minimalist real estate office workspace background, wooden desk with dual computer monitors "
    "showing property listing websites in the distance, beige walls, large window with natural daylight, "
    "indoor plant on the side, no people, professional clean office interior photography, wide shot, "
    "soft natural lighting",

    # 4. 簽約桌
    "Bright professional conference room interior, polished wooden meeting table with legal contract papers "
    "stack and elegant fountain pen and two ceramic coffee cups arranged neatly, leather office chairs around "
    "the table, warm pendant ceiling lights, beige walls, no people, real estate signing room, "
    "wide angle, soft warm lighting",

    # 5. 七期高樓背景（高端物件）
    "Inside luxury high-rise apartment with floor-to-ceiling glass window, panoramic Taichung 7th district "
    "city skyline view with modern skyscrapers in the distance, golden hour warm sunlight, "
    "minimalist contemporary interior, hardwood floor, no people, architectural luxury real estate "
    "photography, wide angle",

    # 6. 北屯街景（在地耕耘）
    "Taiwan Taichung Beitun district urban street scene, traditional taiwanese commercial street with "
    "various shop signage, scooters parked on the side, late afternoon golden sunlight, "
    "trees along the street, no people, documentary urban photography, wide angle, authentic local atmosphere",

    # 7. 餐廳討論（喝咖啡）
    "Cozy modern cafe interior, wooden table with one ceramic coffee cup and a leather folder of documents "
    "placed neatly, warm pendant lights overhead, beige and wood tones walls, large window with natural light, "
    "indoor plant in background, no people, professional warm interior photography, wide shot",

    # 8. 拿圖紙（改：滿牆平面圖辦公室）
    "Real estate office interior with one wall covered in architectural floor plans and property blueprints "
    "and land survey drawings pinned up, wooden desk with rolled blueprint papers on the side, "
    "beige walls, natural daylight through window, no people, professional architecture office interior, "
    "wide angle, soft lighting",

    # 9. 看手機（改：多螢幕辦公桌）
    "Modern minimalist office desk workspace, three computer screens on the desk in the distance displaying "
    "various real estate listing platforms, smartphone resting on the wooden desk surface, beige walls, "
    "natural daylight from window, no people, professional clean workspace photography, wide angle",

    # 10. 站立看物件（帶看）
    "Empty modern apartment interior for viewing, light oak hardwood floor, large floor-to-ceiling windows "
    "with natural daylight, contemporary minimalist living space, beige walls, no furniture, "
    "no people, real estate viewing photography, wide angle bright interior",

    # 11. 跟客戶握手（改：會議桌簽約環境）
    "Bright modern conference room interior, large wooden table with two ceramic coffee cups and "
    "contract papers placed in the middle, two empty leather office chairs facing each other, "
    "professional real estate office, beige walls, large window with natural daylight, no people, "
    "wide angle, warm soft lighting",

    # 12. 拿鑰匙（改：新屋玄關鑰匙盤）
    "New home entrance foyer interior, light wood shoe cabinet with a small ceramic tray holding "
    "shiny house keys on top, light wood door frame, natural daylight streaming through the entryway, "
    "beige walls, indoor plant in corner, no people, professional interior real estate photography, "
    "wide angle, warm welcoming atmosphere",
]

LABELS = [
    "北歐風客廳", "社區大樓外觀", "辦公室電腦", "簽約桌",
    "七期高樓背景", "北屯街景", "餐廳討論", "滿牆平面圖辦公室",
    "多螢幕辦公桌", "空屋帶看", "會議桌簽約", "新屋玄關鑰匙",
]


# ===================== ComfyUI workflow =====================
def build_workflow(prompt, seed):
    return {
        "1": {"class_type": "UnetLoaderGGUF",
              "inputs": {"unet_name": "flux1-dev-Q4_K_S.gguf"}},
        "2": {"class_type": "DualCLIPLoader",
              "inputs": {"clip_name1": "clip_l.safetensors",
                         "clip_name2": "t5xxl_fp8_e4m3fn.safetensors",
                         "type": "flux"}},
        "3": {"class_type": "CLIPTextEncodeFlux",
              "inputs": {"clip": ["2", 0], "clip_l": prompt[:77],
                         "t5xxl": prompt, "guidance": 3.5}},
        "4": {"class_type": "EmptySD3LatentImage",
              "inputs": {"width": W, "height": H, "batch_size": 1}},
        "5": {"class_type": "ModelSamplingFlux",
              "inputs": {"model": ["1", 0], "max_shift": 1.15,
                         "base_shift": 0.5, "width": W, "height": H}},
        "6": {"class_type": "FluxGuidance",
              "inputs": {"conditioning": ["3", 0], "guidance": 3.5}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["5", 0], "positive": ["6", 0],
                         "negative": ["3", 0], "latent_image": ["4", 0],
                         "seed": seed, "steps": 20, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "8": {"class_type": "VAELoader",
              "inputs": {"vae_name": "ae.safetensors"}},
        "9": {"class_type": "VAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["8", 0]}},
        "10": {"class_type": "SaveImage",
               "inputs": {"images": ["9", 0], "filename_prefix": "teddy_ctx"}},
    }


def submit(wf):
    data = json.dumps({"prompt": wf, "client_id": str(uuid.uuid4())[:8]}).encode()
    req = urllib.request.Request(
        f"{COMFY}/prompt", data=data,
        headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())["prompt_id"]


def wait_png(pid, timeout=900):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(3)
        try:
            h = json.loads(urllib.request.urlopen(
                f"{COMFY}/history/{pid}", timeout=10).read())
            if pid not in h:
                continue
            for node_out in h[pid].get("outputs", {}).values():
                imgs = node_out.get("images", [])
                if imgs:
                    fn = imgs[0]["filename"]
                    sub = imgs[0].get("subfolder", "")
                    ft = imgs[0].get("type", "output")
                    p = urllib.parse.urlencode(
                        {"filename": fn, "subfolder": sub, "type": ft})
                    return urllib.request.urlopen(
                        f"{COMFY}/view?{p}", timeout=60).read()
        except Exception:
            continue
    return None


# ===================== 主流程 =====================
def cutout_portrait():
    """rembg 去背景泰肖像 → RGBA PNG（強制 CPU provider 避免跟 ComfyUI 搶 GPU）"""
    if CUTOUT.exists():
        print(f"[cutout] 已有 {CUTOUT.name}，跳過")
        return
    print(f"[cutout] rembg 處理 {PORTRAIT.name} (CPU provider) ...")
    from rembg import new_session, remove
    sess = new_session("u2net", providers=["CPUExecutionProvider"])
    inp = PORTRAIT.read_bytes()
    out = remove(inp, session=sess)
    CUTOUT.write_bytes(out)
    print(f"[cutout] 完成 → {CUTOUT.name}")


def gen_one_bg(idx, prompt, label):
    """跑 FLUX 一張背景"""
    out = WORK / f"bg-{idx:02d}.png"
    if out.exists():
        print(f"[{idx:02d}] {label} 已有背景，跳過")
        return out
    print(f"[{idx:02d}] {label} → FLUX 生成中...")
    t0 = time.time()
    wf = build_workflow(prompt, seed=10000 + idx * 7)
    pid = submit(wf)
    png_bytes = wait_png(pid)
    if png_bytes is None:
        raise RuntimeError(f"[{idx:02d}] FLUX 超時")
    out.write_bytes(png_bytes)
    print(f"[{idx:02d}] {label} 背景完成 ({time.time()-t0:.0f}s) → {out.name}")
    return out


def composite_one(idx, bg_path, label):
    """景泰人像 composite 到背景中央偏下"""
    out = CONTEXTS / f"teddy-context-{idx:02d}.png"
    print(f"[{idx:02d}] composite {label} → {out.name}")

    bg = Image.open(bg_path).convert("RGBA")
    portrait = Image.open(CUTOUT).convert("RGBA")

    # 景泰人像縮放：目標高度 = 背景高度 × 0.78 (~1053px)
    # 4:5 1080x1350，景泰半身約佔 78% 高，底部齊邊
    target_h = int(H * 0.78)
    ratio = target_h / portrait.height
    new_w = int(portrait.width * ratio)
    portrait_resized = portrait.resize(
        (new_w, target_h), Image.LANCZOS)

    # 位置：水平居中，垂直貼底（人像底部對齊畫面底）
    x = (W - new_w) // 2
    y = H - target_h  # 貼底

    # 對人像做極輕微的對比柔化讓它跟背景融合（不要太明顯，景泰要求不過度修圖）
    # 只做 alpha edge feather，色調保留原圖
    alpha = portrait_resized.split()[-1]
    alpha_feathered = alpha.filter(ImageFilter.GaussianBlur(radius=1.2))
    portrait_final = Image.merge(
        "RGBA",
        portrait_resized.split()[:3] + (alpha_feathered,))

    bg.paste(portrait_final, (x, y), portrait_final)
    bg.convert("RGB").save(out, "PNG", optimize=True)
    print(f"[{idx:02d}] {label} 完成 → {out}")
    return out


def tg_notify(msg):
    """推 TG 泰迪的小聲音"""
    try:
        cfg = json.loads(Path(
            r"C:\Users\a0920\.claude\config\telegram_bot.json"
        ).read_text(encoding="utf-8"))
        token = cfg["bot"]["token"]
        chat = cfg["owner"]["telegram_user_id"]
        data = json.dumps({
            "chat_id": chat, "text": msg,
            "parse_mode": "Markdown"
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=data,
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
        print(f"[tg] 推送成功")
    except Exception as e:
        print(f"[tg] 失敗 {e}")


def main():
    print(f"=== 景泰 12 情境圖 ===")
    print(f"輸出 → {CONTEXTS}")

    # 1. 去背
    cutout_portrait()

    # 2-3. 跑 12 張背景 + composite
    results = []
    t_total = time.time()
    for i, (prompt, label) in enumerate(zip(SCENES, LABELS), 1):
        try:
            bg = gen_one_bg(i, prompt, label)
            final = composite_one(i, bg, label)
            results.append((i, label, str(final)))
        except Exception as e:
            print(f"[{i:02d}] {label} 失敗：{e}")
            results.append((i, label, f"FAILED: {e}"))

    total_min = (time.time() - t_total) / 60
    print(f"\n=== 完工 {total_min:.1f} 分鐘 ===")
    for i, label, path in results:
        print(f"  #{i:02d} {label} → {path}")

    # 4. TG 推
    ok = sum(1 for _, _, p in results if not p.startswith("FAILED"))
    msg = (
        f"🎯 *景泰 12 情境圖完工*\n\n"
        f"成功 {ok}/12，耗時 {total_min:.1f} 分鐘\n"
        f"路徑：`teddy-website/public/photos/contexts/teddy-context-NN.png`\n\n"
        f"情境清單：\n"
        + "\n".join(f"  {i:02d}. {label}" for i, label, _ in results)
    )
    tg_notify(msg)


if __name__ == "__main__":
    main()
