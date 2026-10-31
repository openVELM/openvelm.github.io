import { env, pipeline } from '@huggingface/transformers'
import { GITHUB_MODEL_RELEASE, MODEL_OPTIONS } from '@/lib/models'

env.allowLocalModels = false
env.useBrowserCache = true

const mirroredModels = new Set<string>(MODEL_OPTIONS.map((model) => model.id))

function mirrorUrl(input: RequestInfo | URL) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(raw)
  if (url.hostname !== 'huggingface.co') return null

  const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/)
  if (!match || !mirroredModels.has(match[1])) return null
  const asset = `${match[1].replaceAll('/', '--')}--${match[2].replaceAll('/', '--')}`
  return `${GITHUB_MODEL_RELEASE}/${asset}`
}

// Releases use flat asset names. Keep Transformers.js' normal Hugging Face
// URLs for caching, but fetch each file from the GitHub mirror when available.
env.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const mirror = mirrorUrl(input)
  if (!mirror) return fetch(input, init)

  const headers = new Headers(init?.headers)
  headers.delete('Authorization')
  try {
    const response = await fetch(mirror, { ...init, headers, credentials: 'omit' })
    if (response.ok) {
      post({ type: 'source', source: 'github' })
      return response
    }
  } catch {
    // A mirror outage must not prevent loading from the upstream model repo.
  }

  post({ type: 'source', source: 'huggingface' })
  return fetch(input, init)
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface GenerationResult {
  generated_text: string | ChatMessage[]
}

type Generator = (
  messages: ChatMessage[],
  options: { max_new_tokens: number; do_sample: boolean },
) => Promise<GenerationResult[]>

let generator: Generator | null = null
let loadedModel = ''
let loading: Promise<void> | null = null

const post = (message: unknown) => {
  const scope = self as unknown as { postMessage: (value: unknown) => void }
  scope.postMessage(message)
}

async function load(modelId: string, device: 'webgpu' | 'wasm') {
  if (generator && loadedModel === modelId) return
  if (loading) return loading
  loading = (async () => {
    post({ type: 'status', status: 'loading', message: 'Preparing the local model…' })
    const instance = await pipeline('text-generation', modelId, {
      device,
      dtype: 'q4',
      progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
        if (progress.status === 'progress') {
          post({ type: 'progress', progress: progress.progress ?? 0, file: progress.file ?? '' })
        }
      },
    })
    generator = instance as unknown as Generator
    loadedModel = modelId
    post({ type: 'ready', modelId })
  })()
  try {
    await loading
  } finally {
    loading = null
  }
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as {
    type: 'load' | 'generate'
    modelId: string
    device: 'webgpu' | 'wasm'
    prompt?: string
    projectContext?: string
  }

  try {
    if (message.type === 'load') {
      await load(message.modelId, message.device)
      return
    }

    await load(message.modelId, message.device)
    if (!generator) throw new Error('The local model did not initialize.')

    const system = `You translate video editing requests into JSON. Return only one JSON object, never markdown or commentary.
Schema: {"version":1,"operations":[...]}.
Allowed operations:
{"type":"project.setAspectRatio","value":"9:16"|"1:1"|"16:9"}
{"type":"clip.trimOpening","clipId":"...","duration":2}
{"type":"clip.split","clipId":"...","timelineTime":2}
{"type":"clip.remove","clipId":"..."}
{"type":"clip.setSpeed","clipId":"...","value":1.5}
{"type":"clip.setZoom","clipId":"...","value":1.2}
{"type":"clip.setLook","clipId":"...","value":"original"|"vivid"|"warm"|"mono"}
{"type":"clip.move","clipId":"...","direction":"left"|"right"}
{"type":"caption.setStyle","preset":"yellow"|"white"|"minimal"}
{"type":"caption.add","text":"...","start":0,"end":2}
Use only clip IDs from the project. Keep edits modest and reversible. If no caption exists, do not use caption.setStyle.`

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: `PROJECT:\n${message.projectContext}\n\nREQUEST:\n${message.prompt}` },
    ]
    post({ type: 'status', status: 'thinking', message: 'Planning edits on this device…' })
    const output = await generator(messages, { max_new_tokens: 160, do_sample: false })
    const generated = output[0]?.generated_text
    const text = Array.isArray(generated) ? generated.at(-1)?.content ?? '' : generated ?? ''
    post({ type: 'result', text })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'Local AI could not complete this request.' })
  }
}
