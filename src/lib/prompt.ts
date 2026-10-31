import type { OperationPlan, Project } from './editor'
import { clipDuration, operationPlanSchema, projectDuration } from './editor'

export function projectContext(project: Project) {
  return JSON.stringify({
    aspect: project.aspect,
    duration: Number(projectDuration(project).toFixed(2)),
    clips: project.clips.map((clip, index) => ({
      clipId: clip.id,
      number: index + 1,
      duration: Number(clipDuration(clip).toFixed(2)),
      sourceStart: Number(clip.sourceStart.toFixed(2)),
      sourceEnd: Number(clip.sourceEnd.toFixed(2)),
      speed: clip.speed,
      look: clip.look,
    })),
    captions: project.captions.map((caption) => ({ text: caption.text, start: caption.start, end: caption.end, preset: caption.preset })),
  })
}

export function extractOperationPlan(text: string): OperationPlan {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return an editing plan.')
  const candidate = trimmed.slice(start, end + 1)
  const parsed = JSON.parse(candidate) as { version?: number; operations?: unknown }
  return operationPlanSchema.parse({ version: 1, operations: parsed.operations })
}
