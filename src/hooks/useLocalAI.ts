import { useCallback, useEffect, useRef, useState } from 'react'
import { MODEL_OPTIONS } from '@/lib/models'

export { GITHUB_MODEL_RELEASE, MODEL_OPTIONS } from '@/lib/models'

export type AIStatus = 'idle' | 'loading' | 'ready' | 'thinking' | 'error'

const INACTIVITY_TIMEOUT = 60_000

export function useLocalAI() {
  const workerRef = useRef<Worker | null>(null)
  const watchdogRef = useRef<number | null>(null)
  const pendingRef = useRef<{ resolve: (text: string) => void; reject: (error: Error) => void } | null>(null)
  const [status, setStatus] = useState<AIStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [progressFile, setProgressFile] = useState('')
  const [error, setError] = useState('')
  const [modelId, setModelId] = useState<string>(MODEL_OPTIONS[0].id)
  const [cached, setCached] = useState(false)
  const [source, setSource] = useState<'github' | 'huggingface' | null>(null)
  const [runtimeNotice, setRuntimeNotice] = useState('')
  const [device, setDevice] = useState<'webgpu' | 'wasm'>(
    typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm',
  )

  useEffect(() => {
    let active = true
    const gpu = (navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown | null> }
    }).gpu
    if (!gpu) {
      setDevice('wasm')
      return
    }
    void gpu.requestAdapter().then((adapter) => {
      if (active) setDevice(adapter ? 'webgpu' : 'wasm')
    }).catch(() => {
      if (active) setDevice('wasm')
    })
    return () => { active = false }
  }, [])

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current)
    watchdogRef.current = null
  }, [])

  const stopWorker = useCallback((reason: string) => {
    clearWatchdog()
    workerRef.current?.terminate()
    workerRef.current = null
    pendingRef.current?.reject(new Error(reason))
    pendingRef.current = null
    setStatus('error')
    setError(reason)
  }, [clearWatchdog])

  const armWatchdog = useCallback(() => {
    clearWatchdog()
    watchdogRef.current = window.setTimeout(() => {
      stopWorker('The model stopped responding for 60 seconds, so the task was cancelled. Instant commands still work.')
    }, INACTIVITY_TIMEOUT)
  }, [clearWatchdog, stopWorker])

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type: string; status?: AIStatus; message?: string; progress?: number; file?: string; text?: string; source?: 'github' | 'huggingface'; device?: 'webgpu' | 'wasm' }
      if (message.type === 'runtime') {
        if (message.device) setDevice(message.device)
        setRuntimeNotice(message.message ?? '')
      } else if (message.type === 'source') {
        setSource(message.source ?? null)
      } else if (message.type === 'progress') {
        armWatchdog()
        setStatus('loading')
        setProgress(Math.max(0, Math.min(100, message.progress ?? 0)))
        setProgressFile(message.file ?? '')
      } else if (message.type === 'status') {
        armWatchdog()
        if (message.status) setStatus(message.status)
        if (message.status === 'loading') setProgress(0)
      } else if (message.type === 'ready') {
        clearWatchdog()
        if (message.device) setDevice(message.device)
        setStatus('ready')
        setProgress(100)
        setCached(true)
        setError('')
      } else if (message.type === 'result') {
        clearWatchdog()
        setStatus('ready')
        pendingRef.current?.resolve(message.text ?? '')
        pendingRef.current = null
      } else if (message.type === 'error') {
        clearWatchdog()
        const reason = message.message ?? 'Local AI failed.'
        setStatus('error')
        setError(reason)
        pendingRef.current?.reject(new Error(reason))
        pendingRef.current = null
      }
    }
    worker.onerror = () => {
      stopWorker('The AI worker could not start. Instant commands still work.')
    }
    workerRef.current = worker
    return worker
  }, [armWatchdog, clearWatchdog, stopWorker])

  const checkCache = useCallback(async () => {
    if (!('caches' in window)) return
    try {
      const cache = await caches.open('transformers-cache')
      const requests = await cache.keys()
      setCached(requests.some((request) => request.url.includes(modelId)))
    } catch {
      setCached(false)
    }
  }, [modelId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void checkCache(), 0)
    return () => window.clearTimeout(timeout)
  }, [checkCache])

  useEffect(() => () => {
    clearWatchdog()
    workerRef.current?.terminate()
    pendingRef.current?.reject(new Error('The local AI task was cancelled.'))
  }, [clearWatchdog])

  const loadModel = useCallback(() => {
    setError('')
    setRuntimeNotice('')
    setSource(null)
    setStatus('loading')
    setProgress(0)
    armWatchdog()
    ensureWorker().postMessage({ type: 'load', modelId, device })
  }, [armWatchdog, device, ensureWorker, modelId])

  const generate = useCallback(async (prompt: string, projectContext: string) => {
    setError('')
    const worker = ensureWorker()
    return new Promise<string>((resolve, reject) => {
      pendingRef.current = { resolve, reject }
      armWatchdog()
      worker.postMessage({ type: 'generate', modelId, device, prompt, projectContext })
    })
  }, [armWatchdog, device, ensureWorker, modelId])

  const clearModel = useCallback(async () => {
    clearWatchdog()
    workerRef.current?.terminate()
    workerRef.current = null
    pendingRef.current = null
    if ('caches' in window) await caches.delete('transformers-cache')
    setCached(false)
    setSource(null)
    setRuntimeNotice('')
    setStatus('idle')
    setProgress(0)
    setError('')
  }, [clearWatchdog])

  return {
    status,
    progress,
    progressFile,
    error,
    modelId,
    setModelId,
    cached,
    source,
    runtimeNotice,
    device,
    loadModel,
    generate,
    clearModel,
    checkCache,
  }
}
