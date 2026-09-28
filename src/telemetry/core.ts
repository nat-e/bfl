import { type Attributes, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type { BflError } from '../errors.js'
import type { JobHooks } from '../hooks.js'
import type { BaseJobInput, FailedJob, MediaFile, ReadyJob } from '../job.js'
import { VERSION } from '../version.js'

/**
 * Data for writing a genai OTel span
 */
export type SpanData = {
  resourceType: 'image' | 'video'
  model: string
  startedAt: number // ms since epoch
  attributes: Attributes // the resource's own attributes, e.g. its request settings
  content: {
    // written only when recordContent is true
    prompt: string
    output?: MediaFile
  }
  userId?: string
  jobId?: string
  /** The cost, in credits. 1 credit = 1 US cent. */
  cost?: number
  error?: { type: string; message?: string }
}

/**
 * A Job lifecycle hooks that takes care of sending OpenTelemetry
 * spans for each job. Each resource extends it with its own attributes.
 *
 * The spans will be tagged with the otel.genai attributes, providing seamless integrations with
 * Langfuse and other AI observability tools
 */
export abstract class JobTelemetry<Input extends BaseJobInput> implements JobHooks<Input> {
  readonly #recordContent: boolean
  readonly #serverAddress: string

  constructor(opts: { recordContent: boolean; serverAddress: string }) {
    this.#recordContent = opts.recordContent
    this.#serverAddress = opts.serverAddress
  }

  /** What the resource generates, written as the span's output type. */
  protected abstract readonly resourceType: SpanData['resourceType']

  /**
   * Returns the list of attributes for this resource type.
   * It will be merged with common attributes.
   */
  protected abstract getSpanAttributes(input: Input): Attributes

  #getSpan(input: Input, startedAt: number, media?: MediaFile): SpanData {
    return {
      resourceType: this.resourceType,
      model: input.model,
      startedAt,
      attributes: this.getSpanAttributes(input),
      content: {
        prompt: input.prompt,
        output: media,
      },
      userId: input.user,
    }
  }

  onSubmitFailed(input: Input, err: BflError, startedAt: number): void {
    this.#write({
      ...this.#getSpan(input, startedAt),
      error: { type: err.code, message: err.message },
    })
  }

  onJobReady(job: ReadyJob<Input>): void {
    this.#write({
      ...this.#getSpan(job.input, job.startedAt, job.media),
      jobId: job.id,
      cost: job.cost,
    })
  }

  onJobFailed(job: FailedJob<Input>): void {
    this.#write({
      ...this.#getSpan(job.input, job.startedAt),
      jobId: job.id,
      cost: job.cost,
      error: { type: job.error.type },
    })
  }

  #write(data: SpanData): void {
    const { error } = data
    const finishReason = toFinishReason(error)
    // The span starts and ends here, so all attributes are passed at the start.
    const attributes: Attributes = {
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.provider.name': 'black_forest_labs',
      'gen_ai.output.type': data.resourceType,
      'server.address': this.#serverAddress,
      'gen_ai.request.model': data.model,
      ...validAttributes(data.attributes),
      'gen_ai.response.finish_reasons': [finishReason],
    }

    if (data.jobId !== undefined) {
      attributes['gen_ai.response.id'] = data.jobId
    }
    if (data.userId !== undefined) {
      attributes['user.id'] = data.userId
    }
    if (data.cost !== undefined) {
      attributes['gen_ai.usage.cost'] = data.cost / 100 // US dollars: Langfuse reads it that way
      attributes['black_forest_labs.cost.credits'] = data.cost
    }
    if (error) {
      attributes['error.type'] = error.type
    }

    if (this.#recordContent) {
      const { prompt, output } = data.content
      const part = { type: 'text', content: prompt }
      attributes['gen_ai.input.messages'] = JSON.stringify([{ role: 'user', parts: [part] }])
      if (output !== undefined) {
        attributes['gen_ai.output.messages'] = JSON.stringify([
          {
            role: 'assistant',
            parts: [
              {
                type: 'uri',
                modality: data.resourceType,
                mime_type: output.mimeType,
                uri: output.url,
              },
            ],
            finish_reason: finishReason,
          },
        ])
      }
    }
    // Looked up for each span, so it works whenever the app sets up OpenTelemetry.
    const span = trace.getTracer('@bfl/sdk', VERSION).startSpan(`generate_content ${data.model}`, {
      kind: SpanKind.CLIENT,
      // A Date, not a number: OpenTelemetry before 2.10 reads a number older than the
      // process start as time since the process started, e.g. for a job started elsewhere.
      startTime: new Date(data.startedAt),
      attributes,
    })
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    }
    span.end()
  }
}

// The span's finish reason: stop when ready, content_filter when the job was moderated.
function toFinishReason(error: SpanData['error']): string {
  if (!error) {
    return 'stop'
  }
  const moderated = error.type === 'request_moderated' || error.type === 'content_moderated'
  return moderated ? 'content_filter' : 'error'
}

// Unset values, e.g. settings left to API's defaults (which the SDK doesn't know), get no attribute.
function validAttributes(values: Record<string, unknown>): Attributes {
  const attributes: Attributes = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value
    }
  }
  return attributes
}
