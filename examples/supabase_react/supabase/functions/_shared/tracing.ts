import { LangfuseSpanProcessor } from 'npm:@langfuse/otel@5'
import { trace } from 'npm:@opentelemetry/api@1'
import { BasicTracerProvider } from 'npm:@opentelemetry/sdk-trace-base@2'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

// Sends the SDK's spans to Langfuse (LANGFUSE_* secrets) as soon as they end.
const langfuse = new LangfuseSpanProcessor({ exportMode: 'immediate' })

// The worker can stop right after the response: this keeps it alive until each span is sent.
const keepAlive = {
  onStart() {},
  onEnd() {
    EdgeRuntime.waitUntil(langfuse.forceFlush())
  },
  forceFlush: async () => {},
  shutdown: async () => {},
}

trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [langfuse, keepAlive] }))
