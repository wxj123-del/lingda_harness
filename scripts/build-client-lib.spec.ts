import { describe, expect, it } from 'vitest'
import { buildClientLibrary } from './build-client-lib.ts'

const typecheck = ['exec', 'tsc', '-b', 'tsconfig.client.json']
const bundle = ['exec', 'tsdown', '--env.DSH_BUILD_FACE', 'client']

describe('Client library build ordering', () => {
  it('stops before bundling when typecheck fails', () => {
    const calls: string[][] = []

    const status = buildClientLibrary((args) => {
      calls.push(args)
      return 2
    })

    expect(status).toBe(2)
    expect(calls).toEqual([typecheck])
  })

  it('propagates a bundle failure after a successful typecheck', () => {
    const calls: string[][] = []

    const status = buildClientLibrary((args) => {
      calls.push(args)
      return calls.length === 1 ? 0 : 7
    })

    expect(status).toBe(7)
    expect(calls).toEqual([typecheck, bundle])
  })

  it('succeeds only after typecheck and bundle both pass', () => {
    const calls: string[][] = []

    const status = buildClientLibrary((args) => {
      calls.push(args)
      return 0
    })

    expect(status).toBe(0)
    expect(calls).toEqual([typecheck, bundle])
  })
})
