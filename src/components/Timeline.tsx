import { Plus, Scissors, Trash2 } from 'lucide-react'
import type { Project } from '@/lib/editor'
import { clipDuration, formatTime, projectDuration } from '@/lib/editor'

interface Props {
  project: Project
  selectedClipId: string | null
  playhead: number
  onSelectClip: (id: string) => void
  onSeek: (time: number) => void
  onSplit: () => void
  onDelete: () => void
  onAddCaption: () => void
}

export function Timeline({ project, selectedClipId, playhead, onSelectClip, onSeek, onSplit, onDelete, onAddCaption }: Props) {
  const duration = projectDuration(project)
  const playheadPercent = duration ? Math.min(100, (playhead / duration) * 100) : 0

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(duration, ((event.clientX - bounds.left) / bounds.width) * duration)))
  }

  return (
    <section className="timeline-panel" aria-label="Video timeline">
      <div className="timeline-toolbar">
        <div className="timeline-title">
          <span className="section-label">TIMELINE</span>
          <span className="mono timeline-duration">{formatTime(duration, true)}</span>
        </div>
        <div className="timeline-actions">
          <button className="tool-button" onClick={onAddCaption} disabled={!project.clips.length} title="Add caption at playhead">
            <Plus size={16} /> <span>Caption</span>
          </button>
          <button className="tool-button" onClick={onSplit} disabled={!selectedClipId || !duration} title="Split selected clip at playhead">
            <Scissors size={16} /> <span>Split</span>
          </button>
          <button className="icon-button subtle" onClick={onDelete} disabled={!selectedClipId} aria-label="Delete selected clip" title="Delete selected clip">
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <div className="timeline-ruler" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((tick) => (
          <span key={tick}>{formatTime((duration / 5) * tick)}</span>
        ))}
      </div>

      <div className="tracks" onPointerDown={seekFromPointer}>
        <div className="track-label mono">V1</div>
        <div className="clip-track">
          {project.clips.map((clip, index) => (
            <button
              key={clip.id}
              className={`timeline-clip ${selectedClipId === clip.id ? 'selected' : ''}`}
              style={{ width: `${duration ? (clipDuration(clip) / duration) * 100 : 100}%` }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelectClip(clip.id)}
              aria-label={`Select clip ${index + 1}`}
            >
              <span className="clip-index mono">{String(index + 1).padStart(2, '0')}</span>
              <span className="clip-time mono">{formatTime(clipDuration(clip), true)}</span>
              <span className="clip-texture" />
            </button>
          ))}
          {!project.clips.length && <div className="empty-track">Your clips will appear here</div>}
          {duration > 0 && <div className="playhead" style={{ left: `${playheadPercent}%` }}><span /></div>}
        </div>
        <div className="track-label mono">CC</div>
        <div className="caption-track">
          {project.captions.map((caption) => (
            <div
              className="caption-block"
              key={caption.id}
              style={{
                left: `${duration ? (caption.start / duration) * 100 : 0}%`,
                width: `${duration ? Math.max(3, ((caption.end - caption.start) / duration) * 100) : 0}%`,
              }}
              title={caption.text}
            >
              {caption.text}
            </div>
          ))}
          {duration > 0 && <div className="playhead caption-playhead" style={{ left: `${playheadPercent}%` }} />}
        </div>
      </div>
    </section>
  )
}
