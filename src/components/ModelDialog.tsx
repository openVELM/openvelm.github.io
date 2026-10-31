import { useEffect, useRef } from 'react'
import { Check, Cpu, Database, Download, ExternalLink, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import { MODEL_OPTIONS, useLocalAI } from '@/hooks/useLocalAI'

type AIController = ReturnType<typeof useLocalAI>

interface Props {
  open: boolean
  onClose: () => void
  ai: AIController
}

export function ModelDialog({ open, onClose, ai }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const selected = MODEL_OPTIONS.find((model) => model.id === ai.modelId) ?? MODEL_OPTIONS[0]
  const busy = ai.status === 'loading' || ai.status === 'thinking'

  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="model-dialog" role="dialog" aria-modal="true" aria-labelledby="model-title">
        <div className="dialog-header">
          <div>
            <span className="section-label">ON-DEVICE INTELLIGENCE</span>
            <h2 id="model-title">Your prompts stay yours.</h2>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close model settings"><X size={20} /></button>
        </div>

        <div className="local-explainer">
          <ShieldCheck size={22} />
          <p>The model is downloaded directly to this browser. Inference runs on your device—no prompt or video is sent to VELM.</p>
        </div>

        <div className="model-options" role="radiogroup" aria-label="Language model">
          {MODEL_OPTIONS.map((model) => (
            <button
              key={model.id}
              className={`model-option ${ai.modelId === model.id ? 'selected' : ''}`}
              onClick={() => ai.setModelId(model.id)}
              disabled={busy}
              role="radio"
              aria-checked={ai.modelId === model.id}
            >
              <span className="radio-mark">{ai.modelId === model.id && <span />}</span>
              <span><strong>{model.name}</strong><small>{model.detail}</small></span>
              <small>{model.size}</small>
            </button>
          ))}
        </div>

        <div className="model-facts">
          <div><Cpu size={17} /><span>Runtime</span><strong>{ai.device === 'webgpu' ? 'WebGPU' : 'WASM'}</strong></div>
          <div><Database size={17} /><span>Storage</span><strong>{ai.cached ? 'Downloaded' : 'Not downloaded'}</strong></div>
        </div>

        {busy && (
          <div className="download-progress" aria-live="polite">
            <div className="progress-copy"><span>{ai.status === 'thinking' ? 'Planning your edit…' : 'Downloading model files…'}</span><span className="mono">{Math.round(ai.progress)}%</span></div>
            <div className="progress-track"><span style={{ width: `${ai.progress}%` }} /></div>
            {ai.progressFile && <small>{ai.progressFile}</small>}
          </div>
        )}

        {ai.status === 'ready' && <div className="model-ready"><Check size={17} /> {selected.name} is ready on this device.</div>}
        {ai.error && <div className="error-message" role="alert">{ai.error}<br />Check your connection and available storage, then try again.</div>}

        <div className="dialog-actions">
          {ai.status !== 'ready' ? (
            <button className="primary-button" onClick={ai.loadModel} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}
              {busy ? 'Working locally…' : ai.cached ? 'Load downloaded model' : 'Download & enable'}
            </button>
          ) : (
            <button className="primary-button" onClick={onClose}><Check size={18} /> Start prompting</button>
          )}
          {ai.cached && !busy && <button className="text-button danger" onClick={() => void ai.clearModel()}><Trash2 size={16} /> Delete model</button>}
        </div>

        <a className="model-source" href={`https://huggingface.co/${ai.modelId}`} target="_blank" rel="noreferrer">
          Model source: Hugging Face <ExternalLink size={13} />
        </a>
      </section>
    </div>
  )
}
