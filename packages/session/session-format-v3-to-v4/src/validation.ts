/** V4 header and artifact validation delegated to the frozen V3 rules. */

import { SessionFormatError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV3Header, restoreReleasedV3Artifact } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { v3CompatibleEvent } from './compatibility.ts'

/** Validate the V4 logical header through the released V3 metadata contract. */
export function assertReleasedV4Header(header: SessionFormatHeader): void {
  if (header.version !== 4) throw new SessionFormatError('expected format v4 header')
  assertReleasedV3Header({ ...header, version: 3 })
}

/** Validate a V4 artifact without changing its event identities or payloads. */
export function restoreReleasedV4Artifact(
  artifact: SessionFormatArtifact,
  knownEventTypes: ReadonlySet<string>,
): SessionFormatArtifact {
  assertReleasedV4Header(artifact.header)
  restoreReleasedV3Artifact({
    ...artifact,
    header: { ...artifact.header, version: 3 },
    events: artifact.events.map(v3CompatibleEvent),
  }, knownEventTypes)
  return artifact
}
