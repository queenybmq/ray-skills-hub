"""
使用 Playwright 抓取网页内容，支持 JS 渲染页面和图片下载。

用法:
  uv run python scripts/fetch_url.py <url>
  uv run python scripts/fetch_url.py <url> --wait 5
  uv run python scripts/fetch_url.py <url> --output file.md --images
"""
import asyncio
import sys
import argparse
import re
import hashlib
import requests
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright


def slugify(text: str, max_len: int = 30) -> str:
    """生成安全的文件名 slug"""
    text = re.sub(r'[^\w]', '', text)
    text = text.strip(' -')
    if len(text) > max_len:
        text = text[:max_len]
    return text or 'untitled'


def url_to_filename(url: str) -> str:
    """从 URL 生成唯一文件名"""
    h = hashlib.md5(url.encode()).hexdigest()[:8]
    return h


async def download_images(page, output_dir: Path, base_slug: str) -> list[dict]:
    """下载页面中的图片"""
    images = []
    img_elements = await page.query_selector_all("img")

    for idx, img in enumerate(img_elements):
        try:
            src = await img.get_attribute("src")
            if not src or src.startswith("data:"):
                continue

            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                base = "/".join(page.url.split("/")[:3])
                src = base + src
            elif not src.startswith("http"):
                continue

            unique_id = url_to_filename(src)
            ext = Path(src.split("?")[0].split(".")[-1].lower())
            if ext not in ["jpg", "jpeg", "png", "gif", "webp"]:
                ext = "png"

            local_filename = f"{base_slug}_{idx}_{unique_id}.{ext}"
            local_path = output_dir / local_filename

            try:
                response = requests.get(src, timeout=10)
                if response.status_code == 200:
                    with open(local_path, "wb") as f:
                        f.write(response.content)
                    images.append({
                        "original_url": src,
                        "local_path": str(local_path),
                        "local_filename": local_filename,
                    })
                    print(f"  下载图片: {local_filename}", file=sys.stderr)
            except Exception as e:
                print(f"  下载图片失败: {e}", file=sys.stderr)
                continue

        except Exception as e:
            print(f"  下载图片失败: {e}", file=sys.stderr)
            continue

    return images


def to_markdown(data: dict, images: list[dict] = None) -> str:
    lines = [
        f"# {data['title']}",
        "",
        "## 原始链接",
        f"[{data['title']}]({data['url']})",
    ]

    if data['url'] != data['original_url']:
        lines.append(f"- 访问时重定向到: {data['url']}")

    lines += [
        "",
        "## 原文内容快照",
        data["content"].strip(),
    ]

    if images:
        lines.append("")
        lines.append("## 文章图片")
        for img in images:
            lines.append(f"![{Path(img['local_filename']).stem}]({img['local_path']})")

    lines += [
        "",
        "---",
        f"*抓取时间: {data['fetched_at']}*",
    ]
    return "\n".join(lines)


async def main():
    parser = argparse.ArgumentParser(description="抓取网页内容")
    parser.add_argument("url", help="目标 URL")
    parser.add_argument("--wait", type=int, default=0, help="抓取前等待秒数")
    parser.add_argument("--output", "-o", help="输出文件路径（默认打印到 stdout）")
    parser.add_argument("--images", "-i", action="store_true", help="同时下载文章图片")
    parser.add_argument("--image-dir", help="图片保存目录（默认与输出文件同目录/images）")
    args = parser.parse_args()

    print(f"正在抓取: {args.url}", file=sys.stderr)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )

        await page.goto(args.url, wait_until="networkidle")

        if args.wait > 0:
            await asyncio.sleep(args.wait)

        title = await page.title()
        content = await page.inner_text("body")
        url_final = page.url

        images = []
        if args.images and args.output:
            output_path = Path(args.output)
            if args.image_dir:
                image_dir = Path(args.image_dir)
            else:
                image_dir = output_path.parent / f"{output_path.stem}_images"
            image_dir.mkdir(parents=True, exist_ok=True)

            base_slug = slugify(title)
            print(f"下载图片到: {image_dir}", file=sys.stderr)
            images = await download_images(page, image_dir, base_slug)

        await browser.close()

        data = {
            "url": url_final,
            "original_url": args.url,
            "title": title,
            "content": content,
            "fetched_at": datetime.now().isoformat(),
        }

        md = to_markdown(data, images if args.images else None)

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(md)
            print(f"已保存到: {args.output}", file=sys.stderr)
            if images:
                print(f"共下载 {len(images)} 张图片", file=sys.stderr)
        else:
            print(md)


if __name__ == "__main__":
    asyncio.run(main())
