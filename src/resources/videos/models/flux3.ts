import type { VideoFromTextInput, VideoInput } from '../../videos.js'
import { VideoModel } from './video_model.js'

export class VideoModelFlux3 extends VideoModel<'flux3'> {
  readonly id = 'flux3'
  readonly endpoint = '/v1/flux-3-video'

  makeFromTextBody(input: VideoFromTextInput): Record<string, unknown> {
    return {
      // extra may override the settings, but not mode or prompt
      ...this.#buildSubmitBody(input),
      mode: 't2v',
      prompt: input.prompt.trim(),
    }
  }

  /**
   * Build the part of the body shared between all modes for the submit endpoint.
   * INFO: I do not set any defaults here. Defaults should be set on the API side so they are only set once
   * and there is no discrepancies.
   **/
  #buildSubmitBody(input: VideoInput): Record<string, unknown> {
    return {
      duration: input.duration,
      resolution: input.resolution,
      aspect_ratio: input.aspectRatio,
      generate_audio: input.audio,
      user: input.user,
      version: input.version,
      ...input.extra,
    }
  }
}
