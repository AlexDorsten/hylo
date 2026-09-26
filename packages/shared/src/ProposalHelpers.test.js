import { proposalOptionsEqual } from './ProposalHelpers'

describe('proposalOptionsEqual', () => {
  const original = [
    { id: 1, text: 'First', color: null, emoji: null },
    { id: 2, text: 'Second', color: 'green', emoji: '🌱' }
  ]

  it('recognizes a round trip through the editor without resetting votes', () => {
    expect(proposalOptionsEqual(original, [
      { id: '2', text: 'Second', color: 'green', emoji: '🌱', tempId: 'local-2' },
      { id: '1', text: 'First', color: '', emoji: '', __typename: 'ProposalOption' }
    ])).toBe(true)
  })

  it.each([
    [{ id: 1, text: 'Changed' }, original[1]],
    [{ ...original[0], color: 'red' }, original[1]],
    [{ ...original[0], emoji: '🌻' }, original[1]],
    [{ ...original[0], id: 3 }, original[1]],
    [{ text: 'First' }, original[1]],
    [original[0]],
    [...original, { text: 'Third' }],
    [original[0], original[0]],
    []
  ].map(options => [options]))('detects a changed option set: %j', options => {
    expect(proposalOptionsEqual(original, options)).toBe(false)
  })

  it('does not mutate the option lists', () => {
    const reversed = [...original].reverse()
    proposalOptionsEqual(original, reversed)
    expect(reversed[0].id).toBe(2)
    expect(original[0].id).toBe(1)
  })
})
