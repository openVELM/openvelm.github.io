# VELM — Video Editing Language Model

VELM is a browser-only short-form video editor for TikTok, YouTube Shorts, and other vertical video workflows. It combines a non-destructive timeline, captions, reframing, visual looks, and prompt-driven edit plans in a static installable PWA.

## Build for GitHub Pages with Docker

Docker is the only local build requirement; Node.js and npm do not need to be installed on your machine. The repository uses this layout:

```text
app/                 Build configuration, package.json, and package-lock.json
src/                 React application source
public/              Static files, including .nojekyll
scripts/build.sh     Docker build script
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

## Local-first architecture

- Imported video is decoded and rendered locally with HTML video and Canvas 2D.
- Project JSON is stored in IndexedDB; source media is stored in OPFS when available.
- Exports are recorded locally with `canvas.captureStream()`, Web Audio, and MediaRecorder.
- Prompt commands run deterministically without a model whenever possible.
- Broader prompts use Transformers.js and ONNX Runtime in a dedicated Web Worker, with WebGPU or WASM selected from browser capabilities.
- Optional quantized SmolLM2 models download directly from Hugging Face into the Transformers browser cache. Model weights are not included in this repository or the application bundle.
- Model output is parsed as a versioned JSON operation plan, schema-checked, semantically validated, and shown for Apply/Discard review before changing the project.
- Manual and prompt-driven edits share the same atomic, undoable operation pathway.

A model task is cancelled after 60 seconds without a response so a stalled connection cannot block the interface. Instant commands continue to work without model files.

## Export behavior

Export runs in real time: a ten-second edit takes approximately ten seconds to record. The available container and codecs depend on the browser; VELM selects a supported MP4 or WebM combination. Keep the tab visible while exporting for the most reliable result.

## Privacy and network access

VELM has no VELM-operated backend. Videos, project data, and prompts are not uploaded to an application server. Network access is used for the static application itself and, only when requested, model files from Hugging Face. Opening the model-source link also visits Hugging Face.

## Main libraries and assets

Built with React, TypeScript, Vite, Transformers.js, ONNX Runtime, idb, Zod, Lucide icons, Lato, and IBM Plex Mono. The optional language models are `onnx-community/SmolLM2-135M-Instruct` and `onnx-community/SmolLM2-360M-Instruct`, subject to their upstream model licenses. The included demo video and VELM icons are original project assets.
