# VELM — Video Editing Language Model

VELM is a browser-only short-form video editor for TikTok, YouTube Shorts, and other vertical video workflows. It combines a non-destructive timeline, captions, reframing, visual looks, and prompt-driven edit plans in a static installable PWA.

## Build for GitHub Pages with Docker

Docker is the only local build requirement; Node.js and npm do not need to be installed on your machine. The repository uses this layout:

```text
app/                 Build configuration, package.json, and package-lock.json
src/                 React application source
public/              Static files, including .nojekyll
scripts/build.sh     Docker build script
scripts/mirror_models.py  Q4 release-asset packager
.github/workflows/   Manual GitHub model-mirror workflow
docs/                Generated GitHub Pages site
```

Run from the repository root:

```bash
./scripts/build.sh
```

The script assembles `app/`, `src/`, and `public/` in a disposable container-owned workspace. npm installs dependencies and builds there rather than on the host bind mount. Only the finished `docs/` directory is written back to your machine; no host `node_modules/` directory is created. Root `public/` files, including `.nojekyll`, are copied into the deployable site, and generated files retain your host user's ownership.

## Deploy to GitHub Pages

Commit the source and generated `docs/` directory, then push to GitHub. In **Settings → Pages**, choose **Deploy from a branch**, select your branch (usually `main`), and select `/docs`.

Vite uses a relative asset base, so the build works from a repository subpath such as `https://username.github.io/velm/`. No application server, database, environment secret, cloud function, or inference endpoint is required. Use HTTPS (provided by GitHub Pages) for service-worker, persistent-storage, WebGPU, and OPFS support.

## Publish the GitHub model mirror

The app expects public release assets at `openVELM/openvelm.github.io/releases/download/models-v1`. To create them without downloading models to your computer:

1. Push this repository, including `.github/workflows/mirror-models.yml` and `scripts/mirror_models.py`.
2. Open the repository on GitHub and go to **Actions → Mirror models to GitHub Releases → Run workflow**.
3. Wait for the workflow to finish. It creates or updates the public **`models-v1`** release with the Q4 model, tokenizer, configuration, license files, and a `models-manifest.json` containing upstream revisions and SHA-256 hashes.

The models remain available from their official Hugging Face repositories too. VELM tries the GitHub release first and falls back to Hugging Face separately for each file. No Hugging Face token is required for these public models. Model weights stay out of Git history, GitHub Pages, and the application bundle; GitHub Releases hosts them as flat downloadable assets.

## Local-first architecture

- Imported video is decoded and rendered locally with HTML video and Canvas 2D.
- Project JSON is stored in IndexedDB; source media is stored in OPFS when available.
- Exports are recorded locally with `canvas.captureStream()`, Web Audio, and MediaRecorder.
- Prompt commands run deterministically without a model whenever possible.
- Broader prompts use Transformers.js and ONNX Runtime in a dedicated Web Worker. VELM checks for a usable WebGPU adapter and automatically falls back to WASM if WebGPU initialization fails.
- Optional quantized SmolLM2 models download from the GitHub Releases mirror, with automatic Hugging Face fallback, into the Transformers browser cache. Model weights are not included in Git history, the Pages site, or the application bundle.
- Model output is parsed as a versioned JSON operation plan, schema-checked, semantically validated, and shown for Apply/Discard review before changing the project.
- Manual and prompt-driven edits share the same atomic, undoable operation pathway.

A model task is cancelled after 60 seconds without a response so a stalled connection cannot block the interface. Instant commands continue to work without model files.

## Export behavior

Export runs in real time: a ten-second edit takes approximately ten seconds to record. The available container and codecs depend on the browser; VELM selects a supported MP4 or WebM combination. Keep the tab visible while exporting for the most reliable result.

## Privacy and network access

VELM has no VELM-operated backend. Videos, project data, and prompts are not uploaded to an application server. Network access is used for the static application itself and, only when requested, model files from GitHub Releases or Hugging Face. Opening a model-source link also visits the corresponding public host.

## Main libraries and assets

Built with React, TypeScript, Vite, Transformers.js, ONNX Runtime, idb, Zod, Lucide icons, Lato, and IBM Plex Mono. The optional language models are `HuggingFaceTB/SmolLM2-135M-Instruct` and `HuggingFaceTB/SmolLM2-360M-Instruct`, subject to their upstream Apache 2.0 model licenses. The included demo video and VELM icons are original project assets.
