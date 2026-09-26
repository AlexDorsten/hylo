/* eslint-env jest */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { queryHyloAPI } from 'util/graphql'
import mockTranslations from '../../../public/locales/en.json'
import DecisionRounds from './DecisionRounds'

jest.mock('util/graphql', () => ({ queryHyloAPI: jest.fn() }))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), mockTranslations[key] || key),
    i18n: { language: 'en' }
  })
}))
const round = changes => ({
  id: 'round-a', version: 2, phase: 'open', electorateCount: 3,
  canManage: true, canVote: true, eligible: true,
  config: { method: 'systemic_consensus', question: 'Where to meet?', purpose: 'Clarify concerns together.', minimum: 3, deadline: '2099-01-01T12:00:00Z', options: [
    { id: 'a', label: 'Library', passive: false }, { id: 'p', label: 'Keep meeting online', passive: true }
  ] },
  ownBallot: { version: 0, state: 'unanswered', answers: [] }, result: null, ...changes
})
const ok = (field, value) => ({ data: { [field]: value } })
const read = (rows = [round()], canCreate = true) => ok('decisionRounds', { rounds: rows, canCreate, eligibleCount: 3, hasMore: false })
const denied = { errors: [{ extensions: { code: 'DECISION_ACCESS_DENIED' } }] }
beforeEach(() => {
  queryHyloAPI.mockReset()
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'test-request-id') })
})

it('never coerces an unanswered score to zero and retains a complete ballot for an idempotent network retry', async () => {
  queryHyloAPI.mockResolvedValueOnce(read()).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ok('submitDecisionBallot', round({ ownBallot: { version: 1, state: 'vote', answers: [{ optionId: 'a', score: 0 }, { optionId: 'p', score: 5 }] } })))
  render(<DecisionRounds postId='1' />)
  const scores = await screen.findAllByRole('combobox')
  expect(scores[0]).toHaveValue('')
  fireEvent.submit(scores[0].closest('form'))
  expect(queryHyloAPI).toHaveBeenCalledTimes(1)
  fireEvent.change(scores[0], { target: { value: '0' } })
  fireEvent.change(scores[1], { target: { value: '5' } })
  fireEvent.submit(scores[0].closest('form'))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed')
  expect(scores[0]).toHaveValue('0')
  fireEvent.submit(scores[0].closest('form'))
  await screen.findByText('Your complete ballot is saved. You can replace it until the deadline or closure.')
  expect(queryHyloAPI.mock.calls[1][0].variables).toEqual(queryHyloAPI.mock.calls[2][0].variables)
  expect(queryHyloAPI.mock.calls[2][0].variables.input.answers).toEqual([{ optionId: 'a', score: 0 }, { optionId: 'p', score: 5 }])
})

it('refreshes a competing ballot revision after a conflict before another explicit submission', async () => {
  queryHyloAPI.mockResolvedValueOnce(read())
    .mockResolvedValueOnce({ errors: [{ extensions: { code: 'DECISION_CONFLICT' } }] })
    .mockResolvedValueOnce(read([round({ ownBallot: { version: 2, state: 'abstained', answers: [] } })]))
  render(<DecisionRounds postId='1' />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abstain', exact: true }))
  await screen.findByText(/Your abstention is saved/)
  expect(screen.getByRole('alert')).toHaveTextContent('Another change was saved first')
  expect(screen.getAllByRole('combobox')[0]).toHaveValue('')
})

it('removes private content and prevents a late mutation response restoring it after revocation', async () => {
  let resolveMutation
  queryHyloAPI.mockResolvedValueOnce(read()).mockReturnValueOnce(new Promise(resolve => { resolveMutation = resolve }))
    .mockResolvedValueOnce(denied)
  render(<DecisionRounds postId='1' />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abstain', exact: true }))
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument())
  await act(async () => resolveMutation(ok('submitDecisionBallot', round())))
  expect(screen.queryByText('Where to meet?')).not.toBeInTheDocument()
})

it('does not display an old discussion response after navigation', async () => {
  let resolveFirst
  queryHyloAPI.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve })).mockResolvedValueOnce(read([round({ config: { ...round().config, question: 'New discussion' } })]))
  const { rerender } = render(<DecisionRounds postId='1' />)
  rerender(<DecisionRounds postId='2' />)
  await screen.findByText('New discussion')
  await act(async () => resolveFirst(read()))
  expect(screen.queryByText('Where to meet?')).not.toBeInTheDocument()
})

it('removes facilitator controls and an open draft editor when facilitation rights are revoked', async () => {
  queryHyloAPI.mockResolvedValueOnce(read([round({ phase: 'draft', canVote: false })]))
    .mockResolvedValueOnce(read([round({ phase: 'draft', canManage: false, canVote: false })], false))
  render(<DecisionRounds postId='1' />)
  fireEvent.click(await screen.findByRole('button', { name: mockTranslations['Decision edit draft'] }))
  expect(screen.getByLabelText('Question for this round')).toHaveFocus()
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.queryByLabelText('Question for this round')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Open voting' })).not.toBeInTheDocument()
})
