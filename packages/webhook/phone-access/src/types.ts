/**
 * Browser-safe view of one phone-access tunnel. The Remote methods return it,
 * so it lives on the `./types` subpath the client face compiles.
 *
 * @module @deepseek-ai/dsh-phone-access/types
 */

/** What one generate attempt produced, as the card renders it. */
export interface PhoneAccessView {
  /** Public https origin ngrok assigned, when a tunnel is up. */
  readonly publicUrl?: string
  /** Hostname of that origin, the value `--trusted-host` takes. */
  readonly host?: string
  /** Root URL carrying this process's launch token: the QR payload. */
  readonly scanUrl?: string
  /** Command that admits the hostname, run after this process exits. */
  readonly restartCommand?: string
  /** Why the last attempt produced nothing. Absent after a success. */
  readonly error?: string
}
