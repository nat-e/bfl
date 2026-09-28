import type { VideoFromTextInput } from '../../videos.js'

/** The video models this SDK supports. */
export type VideoModelId = 'flux3'

/**
 * Base class for a video generation model.
 * INFO: At the moment Flux3 is the only video model, but this showcase how I would extend the code
 * to support multiple models
 */
export abstract class VideoModel<ModelId extends VideoModelId> {
  /**
   * The ID of the model
   */
  abstract readonly id: ModelId

  /**
   * The submit endpoint for this model
   */
  abstract readonly endpoint: string

  /**
   * Turns user input from text to video generation into the HTTP body the endpoint expect
   */
  abstract makeFromTextBody(input: VideoFromTextInput): Record<string, unknown>
}
