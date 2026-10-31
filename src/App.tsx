import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Captions, Check, Cpu, Download, Film, Import, LoaderCircle, Pause, Play,
  Redo2, Scissors, SlidersHorizontal, Sparkles, Undo2, Upload, X,
} from 'lucide-react'
import type { EditOperation, MediaAsset, Project } from '@/lib/editor'
import {
  applyOperations, clipDuration, clipStartTime, formatTime, makeClip, makeProject,
  projectDuration,
} from '@/lib/editor'
import { loadMedia, loadProject, requestPersistentStorage, saveMedia, saveProject } from '@/lib/storage'
import { useLocalAI } from '@/hooks/useLocalAI'
import type { PreviewHandle } from '@/components/VideoCanvas'
import { VideoCanvas } from '@/components/VideoCanvas'
import { Timeline } from '@/components/Timeline'
import { Inspector } from '@/components/Inspector'
import type { EditorTool } from '@/components/Inspector'
import { PromptPanel } from '@/components/PromptPanel'
import { ModelDialog } from '@/components/ModelDialog'

interface ExportState {
  status: 'recording' | 'done'
  progress: number
  url?: string
  extension?: string
}

const tools = [
  { id: 'cut' as const, label: 'Cut', icon: Scissors },
  { id: 'captions' as const, label: 'Captions', icon: Captions },
  { id: 'look' as const, label: 'Look', icon: SlidersHorizontal },
  { id: 'ai' as const, label: 'AI prompt', icon: Sparkles },
]

function probeVideo(file: File, url: string): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || !video.videoWidth) return reject(new Error('This file does not contain readable video metadata.'))
      resolve({
        id: `asset-${crypto.randomUUID()}`,
        name: file.name,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        size: file.size,
        type: file.type,
      })
    }
    video.onerror = () => reject(new Error('This browser cannot decode that video. Try an MP4 or WebM file.'))
    video.src = url
  })
}

export default function App() {
  const [project, setProject] = useState<Project>(() => makeProject())
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [activeTool, setActiveTool] = useState<EditorTool>('cut')
  const [loaded, setLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'session'>('saved')
  const [modelOpen, setModelOpen] = useState(false)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const [, setHistoryVersion] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const pastRef = useRef<Project[]>([])
  const futureRef = useRef<Project[]>([])
  const urlsRef = useRef<Record<string, string>>({})
  const ai = useLocalAI()
  const duration = projectDuration(project)
  const selectedClip = project.clips.find((clip) => clip.id === selectedClipId)

  useEffect(() => { urlsRef.current = mediaUrls }, [mediaUrls])
  useEffect(() => () => Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url)), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const saved = await loadProject()
        if (saved?.version === 1 && !cancelled) {
          setProject(saved)
          setSelectedClipId(saved.clips[0]?.id ?? null)
          const urls: Record<string, string> = {}
          let missing = 0
          for (const asset of saved.assets) {
            try {
              const file = await loadMedia(asset.id)
              urls[asset.id] = URL.createObjectURL(file)
            } catch { missing += 1 }
          }
          if (!cancelled) {
            setMediaUrls(urls)
            if (missing) setNotice('Some source files are no longer in browser storage. Re-import them to restore playback.')
          }
        }
      } catch {
        if (!cancelled) setNotice('The previous local project could not be restored. You can still start a new edit.')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!loaded) return
    setSaveState('saving')
    const timeout = window.setTimeout(() => {
      void saveProject(project).then(() => setSaveState('saved')).catch(() => setSaveState('session'))
    }, 450)
    return () => window.clearTimeout(timeout)
  }, [project, loaded])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 6500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const commitProject = useCallback((next: Project, withHistory = true) => {
    if (withHistory) {
      pastRef.current = [...pastRef.current.slice(-39), project]
      futureRef.current = []
    }
    setProject(next)
    setHistoryVersion((value) => value + 1)
  }, [project])

  const undo = () => {
    const previous = pastRef.current.pop()
    if (!previous) return
    futureRef.current.push(project)
    setProject(previous)
    setSelectedClipId(previous.clips[0]?.id ?? null)
    setPlayhead(0)
    setPlaying(false)
    setHistoryVersion((value) => value + 1)
  }

  const redo = () => {
    const next = futureRef.current.pop()
    if (!next) return
    pastRef.current.push(project)
    setProject(next)
    setSelectedClipId(next.clips[0]?.id ?? null)
    setPlayhead(0)
    setHistoryVersion((value) => value + 1)
  }

  const importFile = async (file: File) => {
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
      setNotice('Choose an MP4, MOV, or WebM video file.')
      return
    }
    setImporting(true)
    setPlaying(false)
    const url = URL.createObjectURL(file)
    try {
      const asset = await probeVideo(file, url)
      if (asset.duration > 60 * 60) throw new Error('For a responsive phone editor, choose a clip under one hour.')
      const clip = makeClip(asset)
      try {
        await saveMedia(asset.id, file)
        void requestPersistentStorage()
      } catch {
        setSaveState('session')
        setNotice('This clip will be available for this session only; persistent file storage is unavailable.')
      }
      const next: Project = {
        ...project,
        assets: [...project.assets, asset],
        clips: [...project.clips, clip],
        name: project.assets.length ? project.name : file.name.replace(/\.[^.]+$/, ''),
        updatedAt: Date.now(),
      }
      setMediaUrls((current) => ({ ...current, [asset.id]: url }))
      commitProject(next)
      setSelectedClipId(clip.id)
      setPlayhead(projectDuration(next) > clipDuration(clip) ? projectDuration(next) - clipDuration(clip) : 0)
    } catch (error) {
      URL.revokeObjectURL(url)
      setNotice(error instanceof Error ? error.message : 'The video could not be imported.')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const loadDemo = async () => {
    setImporting(true)
    try {
      const response = await fetch('demo.mp4')
      if (!response.ok) throw new Error('The demo clip could not be loaded.')
      const blob = await response.blob()
      await importFile(new File([blob], 'VELM-demo.mp4', { type: 'video/mp4' }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The demo clip could not be loaded.')
      setImporting(false)
    }
  }

  const runOperations = (operations: EditOperation[]) => {
    try {
      const result = applyOperations(project, operations, selectedClipId)
      commitProject(result.project)
      setSelectedClipId(result.selectedClipId)
      setPlayhead((time) => Math.min(time, projectDuration(result.project)))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That edit could not be applied.')
    }
  }

  const splitSelected = () => {
    if (!selectedClip) return
    const start = clipStartTime(project, selectedClip.id)
    if (playhead <= start || playhead >= start + clipDuration(selectedClip)) {
      setNotice('Move the playhead inside the selected clip before splitting.')
      return
    }
    runOperations([{ type: 'clip.split', clipId: selectedClip.id, timelineTime: playhead }])
  }

  const addCaption = () => {
    if (!duration) return
    runOperations([{ type: 'caption.add', text: 'Your story starts here', start: playhead, end: Math.min(duration, playhead + 2.5) }])
    setActiveTool('captions')
  }

  const startExport = async () => {
    if (!previewRef.current || !duration) return
    setPlaying(false)
    setExportState({ status: 'recording', progress: 0 })
    try {
      const result = await previewRef.current.exportVideo((progress) => setExportState({ status: 'recording', progress }))
      if (!result) return setExportState(null)
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'velm-edit'}.${result.extension}`
      anchor.click()
      setExportState({ status: 'done', progress: 1, url, extension: result.extension })
    } catch (error) {
      setExportState(null)
      setNotice(error instanceof Error ? error.message : 'Local export failed.')
    }
  }

  const closeExport = () => {
    if (exportState?.status === 'recording') previewRef.current?.cancelExport()
    if (exportState?.url) URL.revokeObjectURL(exportState.url)
    setExportState(null)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup" aria-label="VELM home">
          <span className="brand-mark"><Film size={20} strokeWidth={2.4} /></span>
          <span className="wordmark">VELM</span>
          <span className="brand-tag">LOCAL VIDEO STUDIO</span>
        </div>
        <input className="project-name" value={project.name} onChange={(event) => commitProject({ ...project, name: event.target.value, updatedAt: Date.now() }, false)} aria-label="Project name" />
        <div className="header-actions">
          <span className={`save-status ${saveState}`}><span />{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved on device' : 'Session only'}</span>
          <div className="history-buttons">
            <button className="icon-button" onClick={undo} disabled={!pastRef.current.length} aria-label="Undo" title="Undo"><Undo2 size={18} /></button>
            <button className="icon-button" onClick={redo} disabled={!futureRef.current.length} aria-label="Redo" title="Redo"><Redo2 size={18} /></button>
          </div>
          <button className="secondary-button import-header" onClick={() => fileInputRef.current?.click()} disabled={importing} aria-label="Import video"><Import size={17} /><span>Import</span></button>
          <button className="primary-button export-button" onClick={() => void startExport()} disabled={!duration || exportState?.status === 'recording'} aria-label="Export video"><Download size={17} /><span>Export</span></button>
        </div>
      </header>

      <input ref={fileInputRef} className="hidden" type="file" accept="video/mp4,video/webm,video/quicktime,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />

      <div className="workspace">
        <nav className="tool-rail" aria-label="Editor tools">
          <div className="rail-tools">
            {tools.map((tool) => <button key={tool.id} className={activeTool === tool.id ? 'active' : ''} onClick={() => setActiveTool(tool.id)}><tool.icon size={20} /><span>{tool.label}</span></button>)}
          </div>
          <button className="rail-model" onClick={() => setModelOpen(true)} title="On-device model settings"><Cpu size={20} /><span>Local AI</span></button>
        </nav>

        <main className="editor-main">
          <section className="preview-panel">
            <div className="preview-meta"><span className="mono">{project.aspect} / {project.assets[0] ? `${project.assets[0].width}×${project.assets[0].height}` : 'NO SOURCE'}</span><span className="privacy-label"><span />100% IN-BROWSER</span></div>
            <div className={`preview-stage ${!project.clips.length ? 'empty' : ''}`}>
              {project.clips.length ? (
                <div className="canvas-wrap" style={{ aspectRatio: project.aspect.replace(':', ' / ') }}>
                  <VideoCanvas ref={previewRef} project={project} mediaUrls={mediaUrls} playhead={playhead} playing={playing} onPlayheadChange={setPlayhead} onPlayingChange={setPlaying} />
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-rule"><span>YOUR FOOTAGE. YOUR DEVICE.</span></div>
                  <h1>CUT WITH<br /><em>INTENT.</em></h1>
                  <p>Prompt the pace. Perfect the frame.<br />Nothing leaves your browser.</p>
                  <div className="empty-actions">
                    <button className="primary-button large" onClick={() => fileInputRef.current?.click()} disabled={importing}>{importing ? <LoaderCircle className="spin" size={19} /> : <Upload size={19} />}{importing ? 'Importing…' : 'Import video'}</button>
                    <button className="text-button demo-button" onClick={() => void loadDemo()} disabled={importing}><Play size={16} /> Try the demo clip</button>
                  </div>
                </div>
              )}
            </div>
            <div className="transport">
              <span className="mono transport-time">{formatTime(playhead, true)} <i>/</i> {formatTime(duration, true)}</span>
              <button className="play-button" onClick={() => { if (playhead >= duration) setPlayhead(0); setPlaying(!playing) }} disabled={!duration || exportState?.status === 'recording'} aria-label={playing ? 'Pause preview' : 'Play preview'}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
              <span className="mono transport-rate">{selectedClip?.speed ?? 1}×</span>
            </div>
            <input className="scrubber" type="range" min={0} max={duration || 0} step={0.01} value={Math.min(playhead, duration)} disabled={!duration || exportState?.status === 'recording'} onChange={(event) => { setPlaying(false); setPlayhead(Number(event.target.value)) }} aria-label="Video playhead" />
          </section>

          <Timeline project={project} selectedClipId={selectedClipId} playhead={playhead} onSelectClip={(id) => { setSelectedClipId(id); setPlaying(false) }} onSeek={(time) => { setPlayhead(time); setPlaying(false) }} onSplit={splitSelected} onDelete={() => selectedClip && runOperations([{ type: 'clip.remove', clipId: selectedClip.id }])} onAddCaption={addCaption} />
        </main>

        <aside className="inspector-panel">
          <PromptPanel project={project} selectedClipId={selectedClipId} playhead={playhead} ai={ai} onApply={runOperations} onOpenModel={() => setModelOpen(true)} />
          <Inspector tool={activeTool} project={project} clip={selectedClip} onOperations={runOperations} onUpdateCaption={(id, changes, commit = true) => commitProject({ ...project, captions: project.captions.map((caption) => caption.id === id ? { ...caption, ...changes } : caption), updatedAt: Date.now() }, commit)} onDeleteCaption={(id) => commitProject({ ...project, captions: project.captions.filter((caption) => caption.id !== id), updatedAt: Date.now() })} onAddCaption={addCaption} />
          <div className="inspector-footer"><span className="local-dot" />No account. No upload. No server.</div>
        </aside>
      </div>

      <nav className="mobile-tool-nav" aria-label="Mobile editor tools">
        {tools.map((tool) => <button key={tool.id} className={activeTool === tool.id ? 'active' : ''} onClick={() => setActiveTool(tool.id)}><tool.icon size={20} /><span>{tool.label}</span></button>)}
      </nav>

      {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button subtle" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16} /></button></div>}

      <ModelDialog open={modelOpen} onClose={() => setModelOpen(false)} ai={ai} />

      {exportState && (
        <div className="modal-backdrop">
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <div className="dialog-header"><div><span className="section-label">LOCAL EXPORT</span><h2 id="export-title">{exportState.status === 'done' ? 'Your cut is ready.' : 'Recording your edit…'}</h2></div><button className="icon-button" onClick={closeExport} aria-label="Close export dialog"><X size={20} /></button></div>
            {exportState.status === 'recording' ? (
              <><div className="export-percentage mono">{Math.round(exportState.progress * 100)}<span>%</span></div><div className="progress-track"><span style={{ width: `${exportState.progress * 100}%` }} /></div><p>Export runs in real time on this device. Keep this tab visible; you can keep using your device normally afterward.</p><button className="secondary-button" onClick={closeExport}>Cancel export</button></>
            ) : (
              <><div className="export-complete"><Check size={28} /><p>Your {exportState.extension?.toUpperCase()} was rendered and downloaded locally.</p></div>{exportState.url && <a className="primary-button" href={exportState.url} download={`velm-edit.${exportState.extension}`}><Download size={18} /> Download again</a>}<button className="text-button" onClick={closeExport}>Back to the edit</button></>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
