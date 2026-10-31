import { z } from 'zod'

export type AspectRatio = '9:16' | '1:1' | '16:9'
export type Look = 'original' | 'vivid' | 'warm' | 'mono'
export type CaptionPreset = 'yellow' | 'white' | 'minimal'
export type CaptionPosition = 'bottom' | 'center'

export interface MediaAsset {
  id: string
  name: string
  duration: number
  width: number
  height: number
  size: number
  type: string
}

export interface Clip {
  id: string
  assetId: string
  sourceStart: number
  sourceEnd: number
  speed: number
  zoom: number
  focusX: number
  focusY: number
  look: Look
}

export interface Caption {
  id: string
  text: string
  start: number
  end: number
  preset: CaptionPreset
  position: CaptionPosition
}

export interface Project {
  version: 1
  id: string
  name: string
  aspect: AspectRatio
  assets: MediaAsset[]
  clips: Clip[]
  captions: Caption[]
  updatedAt: number
}

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export const makeProject = (name = 'Untitled short'): Project => ({
  version: 1,
  id: id('project'),
  name,
  aspect: '9:16',
  assets: [],
  clips: [],
  captions: [],
  updatedAt: Date.now(),
})

export const makeClip = (asset: MediaAsset): Clip => ({
  id: id('clip'),
  assetId: asset.id,
  sourceStart: 0,
  sourceEnd: asset.duration,
  speed: 1,
  zoom: 1,
  focusX: 0.5,
  focusY: 0.5,
  look: 'original',
})

export const clipDuration = (clip: Clip) => Math.max(0, (clip.sourceEnd - clip.sourceStart) / clip.speed)
export const projectDuration = (project: Project) => project.clips.reduce((sum, clip) => sum + clipDuration(clip), 0)

export const clipStartTime = (project: Project, clipId: string) => {
  let time = 0
  for (const clip of project.clips) {
    if (clip.id === clipId) return time
    time += clipDuration(clip)
  }
  return 0
}

export const clipAtTime = (project: Project, time: number) => {
  let start = 0
  for (const clip of project.clips) {
    const end = start + clipDuration(clip)
    if (time < end || clip === project.clips.at(-1)) return { clip, start, end }
    start = end
  }
  return null
}

export const formatTime = (seconds: number, precise = false) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const mins = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const base = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return precise ? `${base}.${Math.floor((safe % 1) * 10)}` : base
}

const baseClip = { clipId: z.string() }
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.setAspectRatio'), value: z.enum(['9:16', '1:1', '16:9']) }),
  z.object({ ...baseClip, type: z.literal('clip.trimOpening'), duration: z.number().min(0.2).max(30) }),
  z.object({ ...baseClip, type: z.literal('clip.trimRange'), sourceStart: z.number().min(0), sourceEnd: z.number().min(0) }),
  z.object({ ...baseClip, type: z.literal('clip.split'), timelineTime: z.number().min(0) }),
  z.object({ ...baseClip, type: z.literal('clip.remove') }),
  z.object({ ...baseClip, type: z.literal('clip.setSpeed'), value: z.number().min(0.5).max(3) }),
  z.object({ ...baseClip, type: z.literal('clip.setZoom'), value: z.number().min(1).max(3) }),
  z.object({ ...baseClip, type: z.literal('clip.setLook'), value: z.enum(['original', 'vivid', 'warm', 'mono']) }),
  z.object({ ...baseClip, type: z.literal('clip.move'), direction: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('caption.setStyle'), preset: z.enum(['yellow', 'white', 'minimal']), captionId: z.string().optional() }),
  z.object({ type: z.literal('caption.add'), text: z.string().min(1).max(160), start: z.number().min(0), end: z.number().min(0) }),
])
export type EditOperation = z.infer<typeof operationSchema>
export const operationPlanSchema = z.object({ version: z.literal(1), operations: z.array(operationSchema).min(1).max(12) })
export type OperationPlan = z.infer<typeof operationPlanSchema>

export interface ApplyResult {
  project: Project
  selectedClipId: string | null
}

export function applyOperations(project: Project, operations: EditOperation[], selectedClipId: string | null): ApplyResult {
  const next = structuredClone(project)
  let selected = selectedClipId

  for (const op of operations) {
    if (op.type === 'project.setAspectRatio') {
      next.aspect = op.value
      continue
    }
    if (op.type === 'caption.setStyle') {
      next.captions = next.captions.map((caption) =>
        !op.captionId || caption.id === op.captionId ? { ...caption, preset: op.preset } : caption,
      )
      continue
    }
    if (op.type === 'caption.add') {
      const end = Math.min(Math.max(op.end, op.start + 0.5), Math.max(projectDuration(next), op.start + 0.5))
      next.captions.push({ id: id('caption'), text: op.text.trim(), start: op.start, end, preset: 'yellow', position: 'bottom' })
      continue
    }

    const index = next.clips.findIndex((clip) => clip.id === op.clipId)
    if (index < 0) throw new Error('The plan refers to a clip that no longer exists.')
    const clip = next.clips[index]

    switch (op.type) {
      case 'clip.trimOpening':
        clip.sourceEnd = Math.min(clip.sourceEnd, clip.sourceStart + op.duration * clip.speed)
        break
      case 'clip.trimRange':
        if (op.sourceEnd - op.sourceStart < 0.2) throw new Error('A clip must be at least 0.2 seconds long.')
        clip.sourceStart = op.sourceStart
        clip.sourceEnd = op.sourceEnd
        break
      case 'clip.split': {
        const start = clipStartTime(next, clip.id)
        const local = op.timelineTime - start
        if (local <= 0.1 || local >= clipDuration(clip) - 0.1) throw new Error('Choose a split point inside the selected clip.')
        const sourcePoint = clip.sourceStart + local * clip.speed
        const right: Clip = { ...clip, id: id('clip'), sourceStart: sourcePoint }
        clip.sourceEnd = sourcePoint
        next.clips.splice(index + 1, 0, right)
        selected = right.id
        break
      }
      case 'clip.remove':
        next.clips.splice(index, 1)
        selected = next.clips[Math.min(index, next.clips.length - 1)]?.id ?? null
        break
      case 'clip.setSpeed':
        clip.speed = op.value
        break
      case 'clip.setZoom':
        clip.zoom = op.value
        break
      case 'clip.setLook':
        clip.look = op.value
        break
      case 'clip.move': {
        const target = op.direction === 'left' ? index - 1 : index + 1
        if (target >= 0 && target < next.clips.length) {
          next.clips.splice(index, 1)
          next.clips.splice(target, 0, clip)
        }
        break
      }
    }
  }

  next.updatedAt = Date.now()
  return { project: next, selectedClipId: selected }
}

export function describeOperation(op: EditOperation, project: Project): string {
  if (op.type === 'project.setAspectRatio') return `Set canvas to ${op.value}`
  if (op.type === 'caption.setStyle') return `Apply ${op.preset} caption style`
  if (op.type === 'caption.add') return `Add caption “${op.text}”`
  const index = project.clips.findIndex((clip) => clip.id === op.clipId)
  const clipLabel = `clip ${index + 1}`
  switch (op.type) {
    case 'clip.trimOpening': return `Shorten ${clipLabel} to ${op.duration}s`
    case 'clip.trimRange': return `Trim ${clipLabel}`
    case 'clip.split': return `Split ${clipLabel} at ${formatTime(op.timelineTime)}`
    case 'clip.remove': return `Remove ${clipLabel}`
    case 'clip.setSpeed': return `Set ${clipLabel} speed to ${op.value}×`
    case 'clip.setZoom': return `Set ${clipLabel} zoom to ${Math.round(op.value * 100)}%`
    case 'clip.setLook': return `Apply ${op.value} look to ${clipLabel}`
    case 'clip.move': return `Move ${clipLabel} ${op.direction}`
  }
}

function selectedOrFirst(project: Project, selectedClipId: string | null) {
  return project.clips.find((clip) => clip.id === selectedClipId) ?? project.clips[0]
}

export function parseBasicPrompt(prompt: string, project: Project, selectedClipId: string | null, playhead: number): EditOperation[] {
  const text = prompt.toLowerCase().trim()
  const clip = selectedOrFirst(project, selectedClipId)
  const operations: EditOperation[] = []

  if (/9\s*:\s*16|vertical|portrait|tiktok|shorts/.test(text)) operations.push({ type: 'project.setAspectRatio', value: '9:16' })
  else if (/16\s*:\s*9|landscape|wide/.test(text)) operations.push({ type: 'project.setAspectRatio', value: '16:9' })
  else if (/1\s*:\s*1|square/.test(text)) operations.push({ type: 'project.setAspectRatio', value: '1:1' })

  const captionPreset = /(yellow|bold).*(caption|text)|(caption|text).*(yellow|bold)/.test(text)
    ? 'yellow' as const
    : /white.*(caption|text)|(caption|text).*white/.test(text)
      ? 'white' as const
      : /minimal.*(caption|text)|(caption|text).*minimal/.test(text)
        ? 'minimal' as const
        : null
  if (captionPreset) {
    if (!project.captions.length && projectDuration(project) > 0) {
      operations.push({ type: 'caption.add', text: 'Your story starts here', start: playhead, end: Math.min(projectDuration(project), playhead + 2.5) })
    }
    operations.push({ type: 'caption.setStyle', preset: captionPreset })
  }

  if (clip) {
    const look = (['vivid', 'warm', 'mono', 'original'] as const).find((value) => new RegExp(`\\b${value}\\b`).test(text))
      ?? (/black and white|monochrome/.test(text) ? 'mono' : undefined)
    if (look) operations.push({ type: 'clip.setLook', clipId: clip.id, value: look })

    const speedMatch = text.match(/(\d(?:\.\d+)?)\s*(?:x|×)\s*speed|speed.*?(\d(?:\.\d+)?)\s*(?:x|×)/)
    const speed = Number(speedMatch?.[1] ?? speedMatch?.[2])
    if (speed >= 0.5 && speed <= 3) operations.push({ type: 'clip.setSpeed', clipId: clip.id, value: speed })

    const openingMatch = text.match(/(?:opening|first clip|intro).*?(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s)\b/)
    if (openingMatch) operations.push({ type: 'clip.trimOpening', clipId: project.clips[0].id, duration: Math.max(0.2, Number(openingMatch[1])) })

    const splitMatch = text.match(/split.*?(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s)?/)
    if (splitMatch) {
      const time = Number(splitMatch[1])
      const target = clipAtTime(project, time)?.clip
      if (target) operations.push({ type: 'clip.split', clipId: target.id, timelineTime: time })
    } else if (/\bsplit\b/.test(text)) {
      operations.push({ type: 'clip.split', clipId: clip.id, timelineTime: playhead })
    }

    const zoomMatch = text.match(/zoom.*?(\d{3})\s*%/)
    if (zoomMatch) operations.push({ type: 'clip.setZoom', clipId: clip.id, value: Number(zoomMatch[1]) / 100 })

    if (/remove|delete/.test(text) && /clip/.test(text)) operations.push({ type: 'clip.remove', clipId: clip.id })
    if (/move.*(left|earlier)/.test(text)) operations.push({ type: 'clip.move', clipId: clip.id, direction: 'left' })
    if (/move.*(right|later)/.test(text)) operations.push({ type: 'clip.move', clipId: clip.id, direction: 'right' })
  }

  if (/punchy|energetic/.test(text) && clip) {
    if (!operations.some((op) => op.type === 'project.setAspectRatio')) operations.push({ type: 'project.setAspectRatio', value: '9:16' })
    operations.push({ type: 'clip.trimOpening', clipId: project.clips[0].id, duration: 2 })
    operations.push({ type: 'clip.setLook', clipId: clip.id, value: 'vivid' })
    if (project.captions.length) operations.push({ type: 'caption.setStyle', preset: 'yellow' })
  }

  return operations.filter((op, index) => operations.findIndex((other) => JSON.stringify(other) === JSON.stringify(op)) === index)
}

export const lookFilters: Record<Look, string> = {
  original: 'none',
  vivid: 'saturate(1.45) contrast(1.12)',
  warm: 'sepia(0.22) saturate(1.25) contrast(1.04)',
  mono: 'grayscale(1) contrast(1.12)',
}

export const aspectDimensions: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 540, height: 960 },
  '1:1': { width: 720, height: 720 },
  '16:9': { width: 960, height: 540 },
}
