import json
from pathlib import Path

import nibabel as nib
import numpy as np


def main(mask_dir: str, out_dir: str) -> None:
    mask_path = Path(mask_dir)
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    dataset = Path.home() / ".totalsegmentator/nnunet/results/Dataset297_TotalSegmentator_total_3mm_1559subj/nnUNetTrainer_4000epochs_NoMirroring__nnUNetPlans__3d_fullres/dataset.json"
    labels = json.loads(dataset.read_text())["labels"]
    first = next(mask_path.glob("*.nii.gz"))
    reference = nib.load(str(first))
    merged = np.zeros(reference.shape, dtype=np.uint8)
    for name, label_id in sorted(labels.items(), key=lambda item: item[1]):
        if name == "background":
            continue
        mask_file = mask_path / f"{name}.nii.gz"
        if mask_file.exists():
            mask = np.asarray(nib.load(str(mask_file)).dataobj) > 0
            merged[mask] = label_id
    nib.Nifti1Image(merged, reference.affine, reference.header).to_filename(str(output / "labels_full.nii.gz"))
    merged.ravel(order="F").tofile(output / "labels_u8.bin")
    print("shape", merged.shape, "labels", np.unique(merged).tolist())


if __name__ == "__main__":
    main("data/example_seg_full.nii.gz", "web/public/cases/example_ct")
