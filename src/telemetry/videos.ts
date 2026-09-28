import type { Attributes } from '@opentelemetry/api'
import type { VideoInput } from '../resources/videos.js'
import { JobTelemetry } from './core.js'

/**
 * Telemetry adapter for videos
 */
export class VideoTelemetry extends JobTelemetry<VideoInput> {
  protected override readonly resourceType = 'video'

  protected override getSpanAttributes(input: VideoInput): Attributes {
    return {
      'black_forest_labs.video.duration': input.duration,
      'black_forest_labs.video.resolution': input.resolution,
      'black_forest_labs.video.aspect_ratio': input.aspectRatio,
      'black_forest_labs.video.audio': input.audio,
    }
  }
}
