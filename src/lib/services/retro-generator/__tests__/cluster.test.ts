import { describe, it, expect } from 'vitest'
import { averageLinkage, eventText } from '../cluster'

describe('eventText', () => {
  it('cuts the clause that relates the event to its forecast', () => {
    expect(eventText("Gadi Eisenkot has been tasked with forming Israel's next government, a precursor to becoming Prime Minister"))
      .toBe("Gadi Eisenkot has been tasked with forming Israel's next government")
    expect(eventText('Netanyahu has publicly endorsed a unity government, which cuts against him refusing a unity offer'))
      .toBe('Netanyahu has publicly endorsed a unity government')
  })

  it('leaves a claim with no such clause alone, minus trailing punctuation', () => {
    expect(eventText('US-mediated talks in Abu Dhabi produced only a prisoner-exchange agreement.'))
      .toBe('US-mediated talks in Abu Dhabi produced only a prisoner-exchange agreement')
  })
})

describe('averageLinkage', () => {
  const a = [1, 0, 0]
  const a2 = [0.95, 0.05, 0]
  const b = [0, 1, 0]
  const b2 = [0.02, 0.98, 0.05]
  const c = [0, 0, 1]

  it('groups vectors above the threshold and leaves the rest alone', () => {
    const clusters = averageLinkage([a, b, a2, c, b2], 0.9).map((m) => [...m].sort()).sort((x, y) => x[0] - y[0])
    expect(clusters).toEqual([[0, 2], [1, 4], [3]])
  })

  it('merges on the average, not the closest pair: a chain does not collapse into one cluster', () => {
    // x–y and y–z are close, x–z is not; at 0.9 average linkage keeps z out of {x, y}.
    const x = [1, 0]
    const y = [Math.cos(0.4), Math.sin(0.4)]
    const z = [Math.cos(0.8), Math.sin(0.8)]
    const clusters = averageLinkage([x, y, z], 0.9)
    expect(clusters).toHaveLength(2)
  })

  it('returns no clusters for no vectors', () => {
    expect(averageLinkage([], 0.88)).toEqual([])
  })
})
