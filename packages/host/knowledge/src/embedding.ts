import type { FeatureExtractionPipeline } from '@huggingface/transformers'
import type { KnowledgeOverview } from './types.ts'

/** Lazy local ONNX model. Failed loads release the promise so a retry can recover. */
export class LocalEmbedding {
  readonly state: KnowledgeOverview['model']
  private pipeline: Promise<FeatureExtractionPipeline> | undefined
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly model: string,
    private readonly cache: string,
    private readonly queryPrefix: string,
  ) {
    this.state = { id: model, status: 'idle', file: '', progress: 0, error: null }
  }

  async embed(texts: string[], query = false): Promise<number[][]> {
    const run = this.tail.then(async () => {
      const extractor = await (this.pipeline ??= this.load())
      const output = await extractor(
        texts.map(text => (query ? this.queryPrefix + text : text)),
        { pooling: 'cls', normalize: true },
      )
      return output.tolist() as number[][]
    })
    this.tail = run.catch(() => {})
    return run
  }

  private async load(): Promise<FeatureExtractionPipeline> {
    Object.assign(this.state, { status: 'loading', error: null })
    try {
      const { pipeline } = await import('@huggingface/transformers')
      const result = await pipeline('feature-extraction', this.model, {
        dtype: 'q8',
        device: 'cpu',
        cache_dir: this.cache,
        progress_callback: (event) => {
          if (event.status === 'progress')
            Object.assign(this.state, { file: event.file, progress: event.progress })
        },
      })
      Object.assign(this.state, { status: 'ready', progress: 100 })
      return result
    } catch (error) {
      this.pipeline = undefined
      Object.assign(this.state, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async dispose(): Promise<void> {
    await this.tail
    if (this.pipeline !== undefined) await (await this.pipeline).dispose()
  }
}
