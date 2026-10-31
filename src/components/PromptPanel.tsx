import { useState } from 'react'
import { ArrowUp, Check, ChevronRight, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { EditOperation, Project } from '@/lib/editor'
import { applyOperations, describeOperation, parseBasicPrompt } from '@/lib/editor'
import { extractOperationPlan, projectContext } from '@/lib/prompt'
import type { useLocalAI } from '@/hooks/useLocalAI'

type AIController = ReturnType<typeof useLocalAI>

interface Props {
  project: Project
  selectedClipId: string | null
  playhead: number
  ai: AIController
  onApply: (operations: EditOperation[]) => void
  onOpenModel: () => void
}

const suggestions = ['Make it vertical and vivid', 'Split at 2 seconds', 'Bold yellow captions', 'Make the opening 2 seconds']

export function PromptPanel({ project, selectedClipId, playhead, ai, onApply, onOpenModel }: Props) {
  const [prompt, setPrompt] = useState('')
  const [plan, setPlan] = useState<{ operations: EditOperation[]; source: 'commands' | 'ai' } | null>(null)
  const [error, setError] = useState('')

  const planPrompt = async (value = prompt) => {
    const clean = value.trim()
    if (!clean || !project.clips.length || ai.status === 'thinking') return
    setError('')
    setPlan(null)
    const basic = parseBasicPrompt(clean, project, selectedClipId, playhead)
    if (basic.length) {
      try {
        applyOperations(project, basic, selectedClipId)
        setPlan({ operations: basic, source: 'commands' })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'That command cannot be applied here.')
      }
      return
    }
    if (ai.status !== 'ready') {
      setError('This request needs the local model. Enable it below, or try one of the instant commands.')
      return
    }
    try {
      const text = await ai.generate(clean, projectContext(project))
      const parsed = extractOperationPlan(text)
      applyOperations(project, parsed.operations, selectedClipId)
      setPlan({ operations: parsed.operations, source: 'ai' })
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message} Try a more specific editing command.` : 'Could not build a valid edit plan.')
    }
  }

  return (
    <section className="prompt-panel" aria-label="Prompt video edits">
      <div className="prompt-heading">
        <div><Sparkles size={17} /><span>DIRECT THE CUT</span></div>
        <button className={`ai-status ${ai.status}`} onClick={onOpenModel} title="Local model settings">
          <span />{ai.status === 'ready' ? 'LOCAL AI' : ai.status === 'loading' ? 'DOWNLOADING' : ai.status === 'thinking' ? 'THINKING' : 'COMMANDS'}<ChevronRight size={13} />
        </button>
      </div>

      <div className="prompt-input-wrap">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void planPrompt()
            }
          }}
          placeholder={project.clips.length ? 'Try “make it punchy and vertical”…' : 'Import a clip to start directing…'}
          disabled={!project.clips.length || ai.status === 'thinking'}
          rows={2}
          aria-label="Describe your video edit"
        />
        <button className="prompt-submit" onClick={() => void planPrompt()} disabled={!prompt.trim() || !project.clips.length || ai.status === 'thinking'} aria-label="Plan prompt edits">
          {ai.status === 'thinking' ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={19} />}
        </button>
      </div>

      {!plan && !error && (
        <div className="prompt-suggestions">
          {suggestions.map((suggestion) => <button key={suggestion} onClick={() => { setPrompt(suggestion); void planPrompt(suggestion) }} disabled={!project.clips.length || ai.status === 'thinking'}>{suggestion}</button>)}
        </div>
      )}

      {error && (
        <div className="prompt-error" role="alert"><p>{error}</p>{ai.status !== 'ready' && <button onClick={onOpenModel}>Enable local AI</button>}<button className="icon-button subtle" onClick={() => setError('')} aria-label="Dismiss prompt error"><X size={15} /></button></div>
      )}

      {plan && (
        <div className="plan-preview">
          <div className="plan-title"><span>{plan.source === 'ai' ? 'LOCAL AI PLAN' : 'INSTANT COMMAND PLAN'}</span><button className="icon-button subtle" onClick={() => setPlan(null)} aria-label="Discard edit plan"><X size={16} /></button></div>
          <ul>{plan.operations.map((operation, index) => <li key={`${operation.type}-${index}`}><Check size={14} />{describeOperation(operation, project)}</li>)}</ul>
          <div className="plan-actions"><button className="primary-button" onClick={() => { onApply(plan.operations); setPlan(null); setPrompt('') }}><Check size={17} /> Apply edits</button><button className="text-button" onClick={() => setPlan(null)}>Discard</button></div>
        </div>
      )}
    </section>
  )
}
