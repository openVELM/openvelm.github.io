import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react'
import type { Caption, Clip, EditOperation, Project } from '@/lib/editor'
import { formatTime } from '@/lib/editor'

export type EditorTool = 'cut' | 'captions' | 'look' | 'ai'

interface Props {
  tool: EditorTool
  project: Project
  clip?: Clip
  onOperations: (operations: EditOperation[]) => void
  onUpdateCaption: (id: string, changes: Partial<Caption>, commit?: boolean) => void
  onDeleteCaption: (id: string) => void
  onAddCaption: () => void
}

export function Inspector({ tool, project, clip, onOperations, onUpdateCaption, onDeleteCaption, onAddCaption }: Props) {
  if (tool === 'ai') return null

  if (tool === 'captions') {
    return (
      <div className="inspector-content">
        <div className="inspector-heading"><div><span className="section-label">CAPTIONS</span><h2>Words that land.</h2></div><button className="icon-button" onClick={onAddCaption} disabled={!project.clips.length} aria-label="Add caption"><Plus size={19} /></button></div>
        <div className="style-row" aria-label="Caption style">
          {(['yellow', 'white', 'minimal'] as const).map((preset) => (
            <button key={preset} className={`caption-preset ${preset}`} onClick={() => onOperations([{ type: 'caption.setStyle', preset }])} disabled={!project.captions.length}>
              <span>Aa</span>{preset}
            </button>
          ))}
        </div>
        <div className="caption-list">
          {project.captions.map((caption, index) => (
            <div className="caption-editor" key={caption.id}>
              <div className="caption-editor-top"><span className="mono">CAP {String(index + 1).padStart(2, '0')}</span><button className="icon-button subtle" onClick={() => onDeleteCaption(caption.id)} aria-label={`Delete caption ${index + 1}`}><Trash2 size={15} /></button></div>
              <textarea value={caption.text} onChange={(event) => onUpdateCaption(caption.id, { text: event.target.value }, false)} rows={2} maxLength={160} aria-label={`Caption ${index + 1} text`} />
              <div className="caption-fields">
                <label>Start<input type="number" min={0} step={0.1} value={caption.start} onChange={(event) => onUpdateCaption(caption.id, { start: Math.max(0, Number(event.target.value)) })} /></label>
                <label>End<input type="number" min={0.1} step={0.1} value={caption.end} onChange={(event) => onUpdateCaption(caption.id, { end: Math.max(caption.start + 0.1, Number(event.target.value)) })} /></label>
                <label>Place<select value={caption.position} onChange={(event) => onUpdateCaption(caption.id, { position: event.target.value as Caption['position'] })}><option value="bottom">Bottom</option><option value="center">Center</option></select></label>
              </div>
            </div>
          ))}
          {!project.captions.length && <div className="inspector-empty"><span className="empty-glyph">Aa</span><p>No captions yet.</p><button className="secondary-button" onClick={onAddCaption} disabled={!project.clips.length}><Plus size={16} /> Add at playhead</button></div>}
        </div>
      </div>
    )
  }

  if (tool === 'look') {
    return (
      <div className="inspector-content">
        <div className="inspector-heading"><div><span className="section-label">FRAME & LOOK</span><h2>Own the vertical.</h2></div></div>
        <label className="field-label">Canvas</label>
        <div className="segmented-control">
          {(['9:16', '1:1', '16:9'] as const).map((aspect) => <button key={aspect} className={project.aspect === aspect ? 'active' : ''} onClick={() => onOperations([{ type: 'project.setAspectRatio', value: aspect }])}>{aspect}</button>)}
        </div>
        <label className="field-label">Selected clip look</label>
        <div className="look-grid">
          {(['original', 'vivid', 'warm', 'mono'] as const).map((look) => (
            <button key={look} className={clip?.look === look ? 'active' : ''} disabled={!clip} onClick={() => clip && onOperations([{ type: 'clip.setLook', clipId: clip.id, value: look }])}>
              <span className={`look-swatch ${look}`} /><span>{look}</span>
            </button>
          ))}
        </div>
        <div className="range-heading"><label htmlFor="look-zoom">Crop zoom</label><span className="mono">{Math.round((clip?.zoom ?? 1) * 100)}%</span></div>
        <input id="look-zoom" type="range" min={1} max={2.5} step={0.05} value={clip?.zoom ?? 1} disabled={!clip} onChange={(event) => clip && onOperations([{ type: 'clip.setZoom', clipId: clip.id, value: Number(event.target.value) }])} />
        <p className="field-help">Fill framing is preserved at every aspect ratio. Zoom reframes from the clip’s center.</p>
      </div>
    )
  }

  const asset = clip ? project.assets.find((item) => item.id === clip.assetId) : undefined
  return (
    <div className="inspector-content">
      <div className="inspector-heading"><div><span className="section-label">CUT & PACE</span><h2>{clip ? `Clip ${project.clips.findIndex((item) => item.id === clip.id) + 1}` : 'Select a clip'}</h2></div></div>
      {clip && asset ? (
        <>
          <div className="trim-readout"><span>Source range</span><strong className="mono">{formatTime(clip.sourceStart, true)} — {formatTime(clip.sourceEnd, true)}</strong></div>
          <div className="range-heading"><label htmlFor="trim-start">Trim in</label><span className="mono">{formatTime(clip.sourceStart, true)}</span></div>
          <input id="trim-start" type="range" min={0} max={Math.max(0, clip.sourceEnd - 0.2)} step={0.1} value={clip.sourceStart} onChange={(event) => onOperations([{ type: 'clip.trimRange', clipId: clip.id, sourceStart: Number(event.target.value), sourceEnd: clip.sourceEnd }])} />
          <div className="range-heading"><label htmlFor="trim-end">Trim out</label><span className="mono">{formatTime(clip.sourceEnd, true)}</span></div>
          <input id="trim-end" type="range" min={clip.sourceStart + 0.2} max={asset.duration} step={0.1} value={clip.sourceEnd} onChange={(event) => onOperations([{ type: 'clip.trimRange', clipId: clip.id, sourceStart: clip.sourceStart, sourceEnd: Number(event.target.value) }])} />
          <label className="field-label">Playback speed</label>
          <div className="segmented-control speed-control">
            {[0.5, 1, 1.5, 2].map((speed) => <button key={speed} className={clip.speed === speed ? 'active' : ''} onClick={() => onOperations([{ type: 'clip.setSpeed', clipId: clip.id, value: speed }])}>{speed}×</button>)}
          </div>
          <label className="field-label">Clip order</label>
          <div className="order-buttons"><button className="secondary-button" onClick={() => onOperations([{ type: 'clip.move', clipId: clip.id, direction: 'left' }])}><ArrowLeft size={16} /> Earlier</button><button className="secondary-button" onClick={() => onOperations([{ type: 'clip.move', clipId: clip.id, direction: 'right' }])}>Later <ArrowRight size={16} /></button></div>
        </>
      ) : <div className="inspector-empty"><p>Import a clip or select one on the timeline to start cutting.</p></div>}
    </div>
  )
}
