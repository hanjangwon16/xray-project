from totalsegmentator.python_api import totalsegmentator

if __name__ == "__main__":
    totalsegmentator("data/example_ct.nii.gz", "data/example_seg_full.nii.gz", fast=True, device="cpu")
    print("SEG_DONE")
