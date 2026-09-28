export type AsyncSubmitResponse = {
  id: string
  polling_url: string
  cost: number | null
  input_mp: number | null
  output_mp: number | null
}

export type ApiModerationReason = 'Violence' | 'Sexual Content' | 'Self Harm'

export type ResultResponse = {
  id: string
  status:
    | 'Task not found'
    | 'Pending'
    | 'Reasoning'
    | 'Generating'
    | 'Request Moderated'
    | 'Content Moderated'
    | 'Ready'
    | 'Error'
  progress: number | null
  result: {
    sample: string // The URL of the finished video
    prompt: string
    seed: string
  } | null
  details: {
    'Moderation Reasons'?: Array<ApiModerationReason> // only on moderated tasks
    error?: string // only on Error tasks
  } | null
  cost?: number
}
