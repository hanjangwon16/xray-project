#!/usr/bin/env python3
"""Convert a NIfTI CT to a web case package: raw int16 HU + case.json."""
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np


def main(src: str, outdir: str) -> None:
    img = nib.load(src)
    img = nib.as_closest_canonical(img)  # RAS orientation
    d = np.asarray(img.dataobj).astype(np.int16)
    aff = img.affine
    spacing = [float(np.linalg.norm(aff[:3, i])) for i in range(3)]
    direction = [
        [float(aff[r, c] / spacing[c]) for c in range(3)] for r in range(3)
    ]
    origin = [float(aff[0, 3]), float(aff[1, 3]), float(aff[2, 3])]

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    d.astype("<i2").ravel(order="F").tofile(out / "volume_i16.bin")
    meta = {
        "caseId": out.name,
        "source": "TotalSegmentator tests/reference_files (dataset CC BY 4.0)",
        "dims": list(d.shape),
        "spacing": spacing,
        "origin": origin,
        "direction": direction,
        "huRange": [int(d.min()), int(d.max())],
        "dtype": "int16",
        "file": "volume_i16.bin",
        "voxelOrder": "x-fastest (i,j,k) -> linear i + j*nx + k*nx*ny",
    }
    (out / "case.json").write_text(json.dumps(meta, indent=2))
    print("dims", d.shape, "spacing", spacing, "origin", origin)
    print("direction", direction)
    print("bytes", d.nbytes)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
