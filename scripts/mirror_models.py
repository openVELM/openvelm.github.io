#!/usr/bin/env python3
"""Mirror only VELM's browser-required Q4 models into flat release assets."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

MODELS = (
    "HuggingFaceTB/SmolLM2-135M-Instruct",
    "HuggingFaceTB/SmolLM2-360M-Instruct",
)
OUTPUT = Path("release-assets")
MANIFEST = OUTPUT / "models-manifest.json"


def asset_name(model: str, relative_path: str) -> str:
    return f"{model.replace('/', '--')}--{relative_path.replace('/', '--')}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    shutil.rmtree(OUTPUT, ignore_errors=True)
    OUTPUT.mkdir(parents=True)
    api = HfApi()
    manifest: dict[str, object] = {"release": "models-v1", "models": []}

    for model in MODELS:
        revision = api.model_info(model).sha
        model_dir = Path(
            snapshot_download(
                repo_id=model,
                revision=revision,
                allow_patterns=["*.json", "onnx/*q4*", "LICENSE*", "README*"],
            )
        )

        required = [model_dir / "config.json", model_dir / "tokenizer.json"]
        missing = [path.name for path in required if not path.is_file()]
        if missing:
            raise RuntimeError(f"{model} is missing required files: {', '.join(missing)}")

        files = sorted(
            path for path in model_dir.rglob("*")
            if path.is_file() and (path.parent == model_dir or "q4" in path.name)
        )
        if not any("q4" in path.name for path in files):
            raise RuntimeError(f"{model} does not contain a Q4 ONNX model")

        records = []
        for source in files:
            relative = source.relative_to(model_dir).as_posix()
            name = asset_name(model, relative)
            destination = OUTPUT / name
            shutil.copy2(source, destination)
            records.append({
                "file": relative,
                "asset": name,
                "bytes": destination.stat().st_size,
                "sha256": sha256(destination),
            })
            print(f"Prepared {name} ({destination.stat().st_size:,} bytes)")

        manifest["models"].append({
            "id": model,
            "revision": revision,
            "files": records,
        })

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST}")


if __name__ == "__main__":
    main()
