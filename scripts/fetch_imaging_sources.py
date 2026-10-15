"""Re-fetch or verify the explicitly catalogued imaging research assets.

Uses data/sources/{manifest,code-manifest}.json, not an unbounded dataset crawl.
Raw assets are local research inputs; this script does not publish them.
"""

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


def digest(path, algorithm):
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(path, asset):
    expected_size = asset.get("actual_bytes", asset.get("bytes"))
    if expected_size is None or not asset.get("sha256"):
        raise ValueError("Missing verified size or SHA-256; catalog the asset first")
    if path.stat().st_size != expected_size:
        raise ValueError(f"Size mismatch: {path}")
    if digest(path, "sha256") != asset["sha256"]:
        raise ValueError(f"SHA-256 mismatch: {path}")
    expected_md5 = asset.get("md5")
    if expected_md5 and digest(path, "md5") != expected_md5:
        raise ValueError(f"Publisher MD5 mismatch: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    sources = ROOT / "data" / "sources"
    assets = json.loads((sources / "manifest.json").read_text())["assets"]
    assets += json.loads((sources / "code-manifest.json").read_text())
    for asset in assets:
        if asset["status"] != "downloaded":
            raise ValueError(f"Unresolved acquisition: {asset['id']}")
        path = (ROOT / asset["path"]).resolve()
        if not path.is_relative_to(sources.resolve()):
            raise ValueError("Asset path escapes data/sources")
        if not path.exists() and not args.verify_only:
            path.parent.mkdir(parents=True, exist_ok=True)
            part = path.with_name(path.name + ".part")
            with urllib.request.urlopen(asset["url"], timeout=60) as response:
                with part.open("wb") as out:
                    while chunk := response.read(1024 * 1024):
                        out.write(chunk)
            verify(part, asset)
            part.replace(path)
        verify(path, asset)
        print(f"Verified {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
