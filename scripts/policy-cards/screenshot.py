"""
Batch screenshot 政策圖卡 HTML → 2x PNG
"""
import sys
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from pathlib import Path
from playwright.sync_api import sync_playwright

OUTPUT_DIR = Path(r"C:\Users\a0920\teddy-website\output\2026-05-22-policy-cards")

def main():
    html_files = sorted(f for f in OUTPUT_DIR.glob("*.html") if f.name != "preview.html")
    print(f"Found {len(html_files)} HTML files")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(device_scale_factor=2)

        for f in html_files:
            page = context.new_page()
            page.goto(f.as_uri())
            page.wait_for_timeout(2500)  # 等 Google Fonts
            card = page.query_selector(".card")
            png_path = f.with_suffix(".png")
            card.screenshot(path=str(png_path))
            page.close()
            print(f"✅ {png_path.name}")

        browser.close()

    print(f"\n全部匯出完成！{len(html_files)} 張 2x PNG")

if __name__ == "__main__":
    main()
