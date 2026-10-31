import { useCallback, useEffect, useRef, useState } from 'react'

export const MODEL_OPTIONS = [
  { id: 'onnx-community/SmolLM2-135M-Instruct', name: 'SmolLM2 135M', detail: 'Smallest · Q4', size: 'Recommended for phones' },
  { id: 'onnx-community/SmolLM2-360M-Instruct', name: 'SmolLM2 360M', detail: 'More capable · Q4', size: 'For devices with more memory' },
] as const

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

  const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'

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
      const message = event.data as { type: string; status?: AIStatus; message?: string; progress?: number; file?: string; text?: string }
      if (message.type === 'progress') {
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
    device,
    loadModel,
    generate,
    clearModel,
    checkCache,
  }
}
