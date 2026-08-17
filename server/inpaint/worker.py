#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

from geom import fit_long_side, pad_to_multiple

MODEL_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
MODEL_PATH = MODELS / "big-lama.pt"


def device_name() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def cmd_check() -> int:
    try:
        import simple_lama_inpainting  # noqa: F401
        import torch  # noqa: F401
    except Exception as exc:
        print(json.dumps({"ok": False, "device": None, "error": str(exc)}))
        return 1
    print(json.dumps({"ok": True, "device": device_name()}))
    return 0


def ensure_model() -> Path:
    if os.environ.get("LAMA_MODEL") and Path(os.environ["LAMA_MODEL"]).is_file():
        return Path(os.environ["LAMA_MODEL"])
    MODELS.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.is_file():
        import urllib.request

        print("downloading LaMa model", file=sys.stderr, flush=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    os.environ["LAMA_MODEL"] = str(MODEL_PATH)
    return MODEL_PATH


def list_frames(folder: Path) -> list[Path]:
    frames = sorted(folder.glob("frame_*.png"))
    if not frames:
        raise SystemExit(f"no frame_*.png in {folder}")
    return frames


def prepare(image, mask):
    from PIL import Image

    w, h = image.size
    nw, nh = fit_long_side(w, h, 720)
    pw, ph = pad_to_multiple(nw), pad_to_multiple(nh)
    img = image.resize((nw, nh), Image.Resampling.LANCZOS) if (nw, nh) != (w, h) else image
    msk = mask.resize((nw, nh), Image.Resampling.NEAREST) if (nw, nh) != (w, h) else mask
    if (pw, ph) != (nw, nh):
        padded = Image.new("RGB", (pw, ph))
        padded.paste(img, (0, 0))
        mp = Image.new("L", (pw, ph), 0)
        mp.paste(msk, (0, 0))
        img, msk = padded, mp
    return img, msk, (w, h), (nw, nh)


def crop_result(result, orig_size, resized):
    from PIL import Image

    nw, nh = resized
    result = result.crop((0, 0, nw, nh))
    if result.size != orig_size:
        result = result.resize(orig_size, Image.Resampling.LANCZOS)
    return result


def cmd_run(input_dir: Path, mask_path: Path, output_dir: Path) -> int:
    from PIL import Image
    from simple_lama_inpainting import SimpleLama
    import torch

    ensure_model()
    dev = torch.device(device_name())
    lama = SimpleLama(device=dev)
    mask = Image.open(mask_path).convert("L")
    frames = list_frames(input_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    n = len(frames)
    for i, frame in enumerate(frames, 1):
        print(f"frame {i}/{n}", file=sys.stderr, flush=True)
        image = Image.open(frame).convert("RGB")
        if mask.size != image.size:
            mask_fit = mask.resize(image.size, Image.Resampling.NEAREST)
        else:
            mask_fit = mask
        img, msk, orig, resized = prepare(image, mask_fit)
        out = lama(img, msk)
        out = crop_result(out, orig, resized)
        out.save(output_dir / frame.name)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--input-dir")
    p.add_argument("--mask")
    p.add_argument("--output-dir")
    args = p.parse_args(argv)
    if args.check:
        return cmd_check()
    if not (args.input_dir and args.mask and args.output_dir):
        p.error("--input-dir --mask --output-dir required")
    return cmd_run(Path(args.input_dir), Path(args.mask), Path(args.output_dir))


if __name__ == "__main__":
    raise SystemExit(main())
