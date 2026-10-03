# -*- coding: utf-8 -*-
"""
AI 生成圖片的機器可讀標記（IPTC DigitalSourceType，寫在 XMP 裡）。

為什麼要有：網站上的 AI 封面圖、區域意象圖，頁面上已經用文字寫了「AI 生成示意圖」，
但圖檔本身沒有標記，Google 圖片搜尋看不出來，可能把它當成社區實景。
Google 建議的做法是在圖檔 XMP 寫
  Iptc4xmpExt:DigitalSourceType = http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia
（台帳 X028 / X036）。這不影響排名，只是誠實標示。

給誰用：
  - scripts/generate_og_local_flux.py（文章封面 /og/*.jpg）
  - scripts/gen_image.py（區域頁代表圖等通用生圖）
  - scripts/backfill_ai_xmp.py（一次性補寫既有圖檔）

兩種寫法：
  1. 新圖：Pillow 存檔時帶 xmp=XMP_AI_BYTES（JPEG）或 pnginfo=png_info_with_xmp()（PNG）
  2. 舊圖：inject_xmp_jpeg() 直接在 JPEG 檔頭插一段 APP1，不重新壓縮，畫面一個像素都不動
"""
from __future__ import annotations

DIGITAL_SOURCE_TYPE = (
    "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
)

_XMP_TEMPLATE = (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
    '  <rdf:Description rdf:about=""\n'
    '    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"\n'
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"\n'
    '    Iptc4xmpExt:DigitalSourceType="{dst}">\n'
    '   <dc:description>\n'
    '    <rdf:Alt>\n'
    '     <rdf:li xml:lang="x-default">{desc}</rdf:li>\n'
    '    </rdf:Alt>\n'
    '   </dc:description>\n'
    '  </rdf:Description>\n'
    ' </rdf:RDF>\n'
    '</x:xmpmeta>\n'
    '<?xpacket end="w"?>'
)

# AI 底圖再疊字／logo 的合成圖（make_brand_og.py 那種）用這個
DIGITAL_SOURCE_TYPE_COMPOSITE = (
    "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"
)

_DESC_AI = "AI 生成的示意圖，非實景照片（AI-generated illustration, not a photograph）"
_DESC_COMPOSITE = "AI 生成底圖加上文字排版的合成圖，非實景照片（composite with AI-generated imagery）"


def build_xmp(dst: str = DIGITAL_SOURCE_TYPE, desc: str = _DESC_AI) -> str:
    """組 XMP 封包字串。說明文字只放事實：AI 生成、非實景。不寫地點、不寫任何賣點。"""
    return _XMP_TEMPLATE.format(dst=dst, desc=desc)


XMP_AI_STR = build_xmp()
XMP_AI_BYTES = XMP_AI_STR.encode("utf-8")
XMP_COMPOSITE_BYTES = build_xmp(DIGITAL_SOURCE_TYPE_COMPOSITE, _DESC_COMPOSITE).encode("utf-8")

# JPEG 的 XMP 放在 APP1，前面要接這串命名空間 + NUL
_XMP_APP1_HEADER = b"http://ns.adobe.com/xap/1.0/\x00"


def png_info_with_xmp():
    """PNG 用：回傳帶 XMP iTXt chunk 的 PngInfo，存檔時 pnginfo=… 傳進去。"""
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_itxt("XML:com.adobe.xmp", XMP_AI_STR, zip=False)
    return info


def has_ai_marker(data: bytes) -> bool:
    """檔案位元組裡找得到 DigitalSourceType 是 AI 類（純 AI 或 AI 合成）就算有標記。

    JPEG／PNG／WebP 都適用（XMP 是明文 UTF-8 存在檔案裡）。"""
    return (
        b"digitalsourcetype/trainedAlgorithmicMedia" in data
        or b"digitalsourcetype/compositeWithTrainedAlgorithmicMedia" in data
    )


def _iter_segments(data: bytes):
    """逐段走 JPEG 檔頭（到 SOS 為止）。yield (marker, start, end)，end 不含。"""
    if data[:2] != b"\xff\xd8":
        raise ValueError("不是 JPEG（缺 SOI）")
    i = 2
    n = len(data)
    while i < n:
        if data[i] != 0xFF:
            raise ValueError(f"JPEG 檔頭在 offset {i} 壞掉")
        # 跳過填充用的連續 0xFF
        while i < n and data[i] == 0xFF:
            i += 1
        marker = data[i]
        i += 1
        seg_start = i - 2
        if marker == 0xDA:  # SOS：之後是壓縮影像資料，檔頭走到這裡為止
            yield marker, seg_start, None
            return
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            yield marker, seg_start, i
            continue
        length = int.from_bytes(data[i:i + 2], "big")
        yield marker, seg_start, i + length
        i += length


def inject_xmp_jpeg(data: bytes, xmp: bytes = XMP_AI_BYTES) -> bytes:
    """在 JPEG 插入（或替換）XMP APP1，不重新壓縮。

    - 既有的 XMP APP1 會被拿掉換成新的（避免一張圖兩份 XMP）
    - 新段落放在 APP0(JFIF)／APP1(Exif) 之後，其他段落與壓縮資料原封不動
    """
    payload = _XMP_APP1_HEADER + xmp
    if len(payload) + 2 > 0xFFFF:
        raise ValueError("XMP 太大，塞不進單一 APP1")
    new_seg = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload

    out = bytearray(b"\xff\xd8")
    inserted = False
    for marker, start, end in _iter_segments(data):
        if end is None:  # SOS 以後全部照抄
            if not inserted:
                out += new_seg
            out += data[start:]
            return bytes(out)
        seg = data[start:end]
        is_xmp = marker == 0xE1 and seg[4:4 + len(_XMP_APP1_HEADER)] == _XMP_APP1_HEADER
        if is_xmp:
            continue  # 舊的 XMP 丟掉
        is_app0_or_exif = marker == 0xE0 or (marker == 0xE1 and seg[4:10] == b"Exif\x00\x00")
        if not inserted and not is_app0_or_exif:
            out += new_seg
            inserted = True
        out += seg
    raise ValueError("JPEG 沒有 SOS，檔案不完整")
