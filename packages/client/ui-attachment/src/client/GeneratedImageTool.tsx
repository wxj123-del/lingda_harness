/** The generated-image tool uses the existing authorized attachment gallery. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { ImageGallery } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'

type Props = PropsRuntime<'tool.call.toolview'> & PropsLocale<'conversation'>

/** Render settled images immediately, retaining raw output for failures and inspection. */
export function GeneratedImageTool({ block, loadImage, t }: Props) {
  if (!('kind' in block)) return <div role="status">{t('image.loading')}</div>
  const images = block.isError ? [] : block.content.flatMap(part => part.type === 'image' ? [{ attachment: part.attachment }] : [])
  const text = block.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  return (
    <div>
      {images.length > 0 && <ImageGallery images={images} load={loadImage} align="start" labels={messageImageLabels(t)} />}
      <details open={block.isError}>
        <summary>{t('image.label')} <code>generate_image</code></summary>
        <pre role={block.isError ? 'alert' : undefined} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '100%' }}>{text}</pre>
      </details>
    </div>
  )
}
