import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { Project } from '@/lib/editor'
import { aspectDimensions, clipAtTime, clipDuration, lookFilters, projectDuration } from '@/lib/editor'

export interface ExportResult {
  blob: Blob
  extension: string
}

export interface PreviewHandle {
  exportVideo: (onProgress: (value: number) => void) => Promise<ExportResult | null>
  cancelExport: () => void
}

interface Props {
  project: Project
  mediaUrls: Record<string, string>
  playhead: number
  playing: boolean
  onPlayheadChange: (time: number) => void
  onPlayingChange: (playing: boolean) => void
}

interface ExportSession {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  mimeType: string
  resolve: (result: ExportResult | null) => void
  reject: (error: Error) => void
  onProgress: (value: number) => void
  completed: boolean
}

const mimeCandidates = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4',
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  'video/webm',
]

export const VideoCanvas = forwardRef<PreviewHandle, Props>(function VideoCanvas(
  { project, mediaUrls, playhead, playing, onPlayheadChange, onPlayingChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<number>(0)
  const activeClipRef = useRef<string>('')
  const exportRef = useRef<ExportSession | null>(null)
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const projectRef = useRef(project)
  const urlsRef = useRef(mediaUrls)
  const playheadRef = useRef(playhead)
  const playingRef = useRef(playing)
  const onPlayheadRef = useRef(onPlayheadChange)
  const onPlayingRef = useRef(onPlayingChange)

  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { urlsRef.current = mediaUrls }, [mediaUrls])
  useEffect(() => { onPlayheadRef.current = onPlayheadChange }, [onPlayheadChange])
  useEffect(() => { onPlayingRef.current = onPlayingChange }, [onPlayingChange])

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || video.readyState < 2) return
    const context = canvas.getContext('2d')
    const current = clipAtTime(projectRef.current, time)
    if (!context || !current) return

    const { clip } = current
    context.save()
    context.fillStyle = '#101010'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.filter = lookFilters[clip.look]

    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight) * clip.zoom
    const width = video.videoWidth * scale
    const height = video.videoHeight * scale
    const x = (canvas.width - width) * clip.focusX
    const y = (canvas.height - height) * clip.focusY
    context.drawImage(video, x, y, width, height)
    context.restore()

    const caption = projectRef.current.captions.find((item) => time >= item.start && time <= item.end)
    if (!caption) return

    const fontSize = Math.round(canvas.width * (caption.preset === 'minimal' ? 0.045 : 0.055))
    const maxWidth = canvas.width * 0.84
    context.font = `${caption.preset === 'minimal' ? 600 : 800} ${fontSize}px Lato, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const words = caption.text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (context.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else line = test
    }
    if (line) lines.push(line)

    const lineHeight = fontSize * 1.08
    const centerY = canvas.height * (caption.position === 'center' ? 0.5 : 0.81)
    const startY = centerY - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((text, index) => {
      const yPos = startY + index * lineHeight
      if (caption.preset !== 'minimal') {
        context.lineWidth = Math.max(4, fontSize * 0.14)
        context.strokeStyle = '#111111'
        context.lineJoin = 'round'
        context.strokeText(text, canvas.width / 2, yPos)
      } else {
        context.fillStyle = 'rgba(0,0,0,.62)'
        const metrics = context.measureText(text)
        context.fillRect(canvas.width / 2 - metrics.width / 2 - 12, yPos - lineHeight / 2, metrics.width + 24, lineHeight)
      }
      context.fillStyle = caption.preset === 'yellow' ? '#ffd600' : '#f7f7f2'
      context.fillText(text, canvas.width / 2, yPos)
    })
  }, [])

  const seek = useCallback(async (time: number) => {
    const video = videoRef.current
    const current = clipAtTime(projectRef.current, time)
    if (!video || !current) return
    const { clip, start } = current
    const url = urlsRef.current[clip.assetId]
    if (!url) return

    if (activeClipRef.current !== clip.id || video.src !== url) {
      activeClipRef.current = clip.id
      video.src = url
      await new Promise<void>((resolve, reject) => {
        const loaded = () => { cleanup(); resolve() }
        const failed = () => { cleanup(); reject(new Error('This video could not be decoded by the browser.')) }
        const cleanup = () => {
          video.removeEventListener('loadeddata', loaded)
          video.removeEventListener('error', failed)
        }
        video.addEventListener('loadeddata', loaded)
        video.addEventListener('error', failed)
        video.load()
      })
    }

    const desired = Math.min(clip.sourceEnd, clip.sourceStart + Math.max(0, time - start) * clip.speed)
    if (Math.abs(video.currentTime - desired) > 0.08) {
      await new Promise<void>((resolve) => {
        const done = () => { video.removeEventListener('seeked', done); resolve() }
        video.addEventListener('seeked', done)
        video.currentTime = desired
        window.setTimeout(done, 500)
      })
    }
    video.playbackRate = clip.speed
    draw(time)
  }, [draw])

  const finishExport = useCallback((completed: boolean) => {
    const session = exportRef.current
    if (!session) return
    session.completed = completed
    session.recorder.stop()
    session.stream.getVideoTracks().forEach((track) => track.stop())
    onPlayingRef.current(false)
  }, [])

  useImperativeHandle(ref, () => ({
    cancelExport: () => finishExport(false),
    exportVideo: async (onProgress) => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || !projectRef.current.clips.length) throw new Error('Import a video before exporting.')
      if (!('MediaRecorder' in window) || !canvas.captureStream) throw new Error('Local recording is not supported in this browser.')
      if (exportRef.current) throw new Error('An export is already running.')

      onPlayingRef.current(false)
      await seek(0)
      const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('No supported local recording format was found.')

      if (!audioDestinationRef.current) {
        const AudioContextClass = window.AudioContext
        const audioContext = new AudioContextClass()
        const source = audioContext.createMediaElementSource(video)
        const destination = audioContext.createMediaStreamDestination()
        source.connect(audioContext.destination)
        source.connect(destination)
        audioContextRef.current = audioContext
        audioDestinationRef.current = destination
      }
      await audioContextRef.current?.resume()

      const stream = canvas.captureStream(30)
      audioDestinationRef.current.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 })

      return new Promise<ExportResult | null>((resolve, reject) => {
        const session: ExportSession = { recorder, stream, chunks, mimeType, resolve, reject, onProgress, completed: false }
        exportRef.current = session
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        recorder.onerror = () => {
          exportRef.current = null
          reject(new Error('The browser interrupted the local recording.'))
        }
        recorder.onstop = () => {
          exportRef.current = null
          if (!session.completed) return resolve(null)
          const blob = new Blob(chunks, { type: mimeType })
          resolve({ blob, extension: mimeType.includes('mp4') ? 'mp4' : 'webm' })
        }
        recorder.start(500)
        onPlayheadRef.current(0)
        playingRef.current = true
        onPlayingRef.current(true)
        video.play().catch(() => {
          finishExport(false)
          reject(new Error('Playback was blocked. Press play once, then try exporting again.'))
        })
      })
    },
  }), [finishExport, seek])

  useEffect(() => {
    playheadRef.current = playhead
    if (!playing) void seek(playhead)
  }, [playhead, project, mediaUrls, playing, seek])

  useEffect(() => {
    playingRef.current = playing
    const video = videoRef.current
    if (!video) return
    if (playing) {
      void seek(playheadRef.current).then(() => video.play())
    } else video.pause()
  }, [playing, seek])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dimensions = aspectDimensions[project.aspect]
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    void seek(playheadRef.current)
  }, [project.aspect, seek])

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current
      if (video && playingRef.current) {
        const current = clipAtTime(projectRef.current, playheadRef.current)
        if (current) {
          const { clip, start, end } = current
          const time = start + (video.currentTime - clip.sourceStart) / clip.speed
          const duration = projectDuration(projectRef.current)
          if (video.currentTime >= clip.sourceEnd - 0.025 || time >= end - 0.015) {
            if (end >= duration - 0.02 || end === projectRef.current.clips.reduce((sum, item) => sum + clipDuration(item), 0)) {
              playheadRef.current = duration
              onPlayheadRef.current(duration)
              exportRef.current?.onProgress(1)
              if (exportRef.current) finishExport(true)
              else {
                playingRef.current = false
                onPlayingRef.current(false)
                video.pause()
              }
            } else {
              playheadRef.current = end + 0.001
              onPlayheadRef.current(end + 0.001)
              void seek(end + 0.001).then(() => video.play())
            }
          } else {
            playheadRef.current = Math.max(start, time)
            onPlayheadRef.current(playheadRef.current)
            exportRef.current?.onProgress(Math.min(1, playheadRef.current / duration))
            draw(playheadRef.current)
          }
        }
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [draw, finishExport, seek])

  useEffect(() => () => {
    exportRef.current?.stream.getTracks().forEach((track) => track.stop())
    void audioContextRef.current?.close()
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="preview-canvas" aria-label="Composited video preview" />
      <video ref={videoRef} className="hidden" playsInline preload="auto" />
    </>
  )
})
