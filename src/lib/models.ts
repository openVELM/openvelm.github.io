export const MODEL_OPTIONS = [
  { id: 'HuggingFaceTB/SmolLM2-135M-Instruct', name: 'SmolLM2 135M', detail: 'Smallest · Q4 · ~118 MB', size: 'Recommended for phones' },
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', name: 'SmolLM2 360M', detail: 'More capable · Q4 · ~273 MB', size: 'For devices with more memory' },
] as const

export const GITHUB_MODEL_RELEASE =
  'https://github.com/openVELM/openvelm.github.io/releases/download/models-v1'
