#!/usr/bin/env python3
"""Export a NIfTI labelmap to uint8 bin aligned with an existing case."""
import json, sys
from pathlib import Path
import nibabel as nib, numpy as np

def main(seg_path, outdir):
    img = nib.as_closest_canonical(nib.load(seg_path))
    d = np.asarray(img.dataobj).astype(np.uint8)
    out = Path(outdir)
    d.tofile(out / "labels_u8.bin")
    print("labels dims", d.shape, "unique", np.unique(d).tolist())

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
