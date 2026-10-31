import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

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
