#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate OG images for teddy-website posts missing ogImage.
Uses Imagen 4 Fast via Vertex AI.
"""

import os
import json
import yaml
import re
import sys
from pathlib import Path
from datetime import datetime
import shutil
import subprocess
from google import genai
from google.genai import types

# Fix Windows encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Environment setup
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS",
                      r"C:\Users\a0920\房仲工作站\.google_sa_key.json")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "teddy-dev-496302")

# Paths
POSTS_DIR = Path(r"C:\Users\a0920\teddy-website\src\content\posts")
PUBLIC_OG_DIR = Path(r"C:\Users\a0920\teddy-website\public\og")
OUTPUTS_DIR = Path(r"C:\Users\a0920\房仲工作站\999_tools\imagen_test\outputs")
DROPBOX_DIR = Path(r"C:\Users\a0920\Dropbox\泰迪資料夾\AI素材庫\Imagen")

# Ensure directories exist
PUBLIC_OG_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
DROPBOX_DIR.mkdir(parents=True, exist_ok=True)

# Initialize Vertex AI client
client = genai.Client(vertexai=True, project="teddy-dev-496302", location="us-central1")

MODEL = "imagen-4.0-fast-generate-001"
ASPECT_RATIO = "9:16"  # OG images should be landscape, but 1200x630 = 1.9:1
# For OG: 1200x630 ≈ 16:8.4 ≈ aspect_ratio not standard in Imagen
# Will generate 9:16 and resize later, or use landscape
ASPECT_RATIO = "16:9"  # Better for OG (1200x630 ≈ 16:9)

def extract_frontmatter(md_content):
    """Extract YAML frontmatter from markdown."""
    match = re.match(r'^---\n(.*?)\n---\n', md_content, re.DOTALL)
    if not match:
        return {}, md_content
    fm_text = match.group(1)
    try:
        frontmatter = yaml.safe_load(fm_text)
    except:
        frontmatter = {}
    body = md_content[match.end():]
    return frontmatter or {}, body

def check_needs_og(md_file):
    """Check if post needs ogImage (frontmatter exists AND actual file exists)."""
    with open(md_file, 'r', encoding='utf-8') as f:
        content = f.read()
    fm, _ = extract_frontmatter(content)

    # Missing frontmatter entry
    if 'ogImage' not in fm or not fm['ogImage']:
        return True

    # Frontmatter exists but referenced file doesn't
    og_path = fm['ogImage']  # e.g., "/og/slug.jpg"
    actual_file = PUBLIC_OG_DIR / og_path.lstrip('/').split('/')[-1]
    if not actual_file.exists():
        return True

    return False

def get_post_info(md_file):
    """Extract title and tags from post."""
    with open(md_file, 'r', encoding='utf-8') as f:
        content = f.read()
    fm, body = extract_frontmatter(content)

    title = fm.get('title', md_file.stem)
    tags = fm.get('tags', [])
    slug = fm.get('slug', md_file.stem)

    return {
        'title': title,
        'tags': tags,
        'slug': slug,
        'frontmatter': fm,
        'body': body,
        'md_file': md_file
    }

def build_prompt(post_info):
    """Build Imagen prompt based on post title and tags."""
    title = post_info['title']
    tags = post_info['tags']

    # Tag-based theme detection
    theme_keywords = {
        '房市': 'real estate market',
        '房價': 'housing prices',
        '投資': 'property investment',
        '北屯': 'Beitun',
        '西屯': 'Xitun',
        '南屯': 'Nantun',
        '豐原': 'Fengyuan',
        '台中': 'Taichung',
        '建案': 'development project',
        '社區': 'community',
        '利率': 'interest rate',
        '貸款': 'mortgage',
        '政策': 'policy',
        '市場': 'market',
    }

    detected_themes = []
    for kw, en in theme_keywords.items():
        if kw in title or any(kw in tag for tag in tags):
            detected_themes.append(en)

    # Build base prompt
    base_theme = detected_themes[0] if detected_themes else "Taiwan real estate market"

    prompt = f"""
Modern architectural real estate market scene, Taiwan Taichung.
Theme: {base_theme}
Scene: Professional magazine-style layout showing {base_theme.lower()}.
Style: Contemporary real estate photography, clean lines, warm tones, professional presentation.
Lighting: Blue hour golden light, soft warm accent lights, professional architectural lighting.
Composition: Wide angle drone perspective, 30° downward tilt, professional framing.
Quality: Photorealistic, sharp focus, magazine cover quality, Architectural Digest style.
Color palette: Warm gold, blue hour teal accents, neutral grays, professional tones.
Mood: Professional, trustworthy, aspirational real estate market insight.
Camera: High-end architectural photography, Hasselblad medium format equivalent, f/5.6, sharp details.
Resolution: Ultra high detail, 8K equivalent sharpness.
""".strip()

    negative_prompt = """
cartoon, 3D render, video game, low quality, blurry, distorted,
anime, illustration, sketch,
Western suburban houses, Hong Kong density, deteriorated buildings,
garbled text, illegible signs,
neon dystopian, fantasy, unrealistic lighting,
oversaturated colors, HDR blown out
""".strip()

    return prompt, negative_prompt

def generate_og_image(post_info):
    """Generate OG image using Imagen."""
    prompt, negative_prompt = build_prompt(post_info)

    print(f"[*] Generating: {post_info['title']}")
    print(f"    Prompt: {prompt[:80]}...")

    try:
        response = client.models.generate_images(
            model=MODEL,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio=ASPECT_RATIO,
                safety_filter_level="BLOCK_ONLY_HIGH",
                person_generation="ALLOW_ADULT",
                negative_prompt=negative_prompt,
            ),
        )

        if not response.generated_images:
            print(f"    [FAIL] Generation failed")
            return None

        img_bytes = response.generated_images[0].image.image_bytes
        return img_bytes

    except Exception as e:
        print(f"    [ERROR] API error: {e}")
        return None

def save_og_image(img_bytes, slug):
    """Save OG image to all locations."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")

    # Public directory (for website)
    public_path = PUBLIC_OG_DIR / f"{slug}.jpg"
    with open(public_path, 'wb') as f:
        f.write(img_bytes)
    print(f"    [OK] Saved public: {public_path}")

    # Outputs directory
    output_filename = f"{timestamp}_imagen4fast_og_{slug}.jpg"
    output_path = OUTPUTS_DIR / output_filename
    with open(output_path, 'wb') as f:
        f.write(img_bytes)
    print(f"    [OK] Saved local: {output_path}")

    # Dropbox
    dropbox_path = DROPBOX_DIR / f"{slug}.jpg"
    with open(dropbox_path, 'wb') as f:
        f.write(img_bytes)
    print(f"    [OK] Saved Dropbox")

    return public_path

def update_frontmatter(md_file, public_path):
    """Update post frontmatter with ogImage path."""
    with open(md_file, 'r', encoding='utf-8') as f:
        content = f.read()

    fm, body = extract_frontmatter(content)

    # Update ogImage (relative path from public/)
    rel_path = f"/og/{public_path.stem}.jpg"
    fm['ogImage'] = rel_path

    # Rebuild frontmatter
    fm_text = yaml.dump(fm, allow_unicode=True, default_flow_style=False, sort_keys=False)
    new_content = f"---\n{fm_text}---\n{body}"

    with open(md_file, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"    [+] Updated frontmatter: ogImage = {rel_path}")

def main():
    """Main workflow."""
    print(">> Teddy Website OG Image Generator")
    print(f"[*] Scanning: {POSTS_DIR}")

    # Scan for posts needing ogImage
    md_files = sorted(POSTS_DIR.glob("*.md"))
    needs_og = [f for f in md_files if check_needs_og(f)]

    print(f"[+] Total {len(md_files)} posts, {len(needs_og)} need OG images")

    if not needs_og:
        print("[OK] All done!")
        return

    print("\n[*] Starting generation...\n")

    success_count = 0
    for i, md_file in enumerate(needs_og, 1):
        print(f"\n[{i}/{len(needs_og)}] Processing: {md_file.name}")

        post_info = get_post_info(md_file)
        img_bytes = generate_og_image(post_info)

        if img_bytes:
            public_path = save_og_image(img_bytes, post_info['slug'])
            update_frontmatter(md_file, public_path)
            success_count += 1
        else:
            print(f"   [SKIP] Generation failed")

    print(f"\n[OK] Done! {success_count}/{len(needs_og)} successful")

if __name__ == "__main__":
    main()
