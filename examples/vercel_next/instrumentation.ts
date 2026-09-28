import { LangfuseSpanProcessor } from '@langfuse/otel'
import { registerOTel } from '@vercel/otel'

export function register() {
  registerOTel({
    serviceName: 'flux3-video-poc',
    spanProcessors: [
      'auto', // Vercel's own tracing
      // Also sends AI spans (gen_ai.* attributes) to Langfuse (LANGFUSE_* env vars).
      // @vercel/otel flushes it at the end of each request.
      new LangfuseSpanProcessor(),
    ],
  })
}
