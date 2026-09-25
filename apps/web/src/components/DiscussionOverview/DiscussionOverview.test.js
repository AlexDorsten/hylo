/* eslint-env jest */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { queryHyloAPI } from 'util/graphql'
import mockTranslations from '../../../public/locales/en.json'
import DiscussionOverview from './DiscussionOverview'

jest.mock('util/graphql', () => ({ queryHyloAPI: jest.fn() }))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), mockTranslations[key] || key),
    i18n: { language: 'en' }
  })
}))

const revision = (version = 1, summary = 'Shared evidence') => ({
  version,
  summary,
  context: 'Original context',
  openQuestions: ['Which evidence is missing?'],
  createdAt: '2026-01-01T12:00:00Z',
  author: { id: '1', name: 'Discussion Author' }
})
const result = (canEdit = true, current = revision()) => ({ canEdit, current, lastSummary: current })
const ok = (field, value) => ({ data: { [field]: value } })

beforeEach(() => queryHyloAPI.mockReset())

it('shows a participant the overview and attributed history without an edit control', async () => {
  queryHyloAPI.mockResolvedValueOnce(ok('discussionOverview', result(false)))
    .mockResolvedValueOnce(ok('discussionHistory', [revision()]))
  render(<DiscussionOverview postId='1' />)
  expect(await screen.findByText('Shared evidence')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit discussion overview' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show revision history' }))
  expect(await screen.findByText(/Revision 1 · Discussion Author/)).toBeInTheDocument()
  expect(queryHyloAPI.mock.calls[1][0].variables).toEqual({ postId: '1', beforeVersion: undefined })
})

it('saves a versioned author edit, splitting question lines, and displays the saved summary', async () => {
  queryHyloAPI.mockResolvedValueOnce(ok('discussionOverview', result()))
    .mockResolvedValueOnce(ok('updateDiscussion', result(true, revision(2, 'New summary'))))
  render(<DiscussionOverview postId='1' />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit discussion overview' }))
  expect(screen.getByLabelText('Context')).toHaveFocus()
  fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'New summary' } })
  fireEvent.change(screen.getByLabelText(/Open questions/), { target: { value: 'First question\n\nSecond question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save overview' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Overview saved.')
  expect(screen.getByText('New summary')).toBeInTheDocument()
  expect(queryHyloAPI.mock.calls[1][0].variables).toEqual({
    postId: '1', expectedVersion: 1, context: 'Original context', summary: 'New summary', openQuestions: ['First question', 'Second question']
  })
  expect(screen.getByRole('status')).toHaveTextContent('Overview saved.')
})

it('keeps a conflicting draft and requires an explicit discard before editing the latest version', async () => {
  queryHyloAPI.mockResolvedValueOnce(ok('discussionOverview', result()))
    .mockResolvedValueOnce({ errors: [{ extensions: { code: 'DISCUSSION_CONFLICT' } }] })
    .mockResolvedValueOnce(ok('discussionOverview', result(true, revision(2, 'Other edit'))))
  render(<DiscussionOverview postId='1' />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit discussion overview' }))
  fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'My unsaved contribution' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save overview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone saved a newer revision')
  expect(screen.getByLabelText('Summary')).toHaveValue('My unsaved contribution')
  expect(screen.getByRole('button', { name: 'Save overview' })).toBeDisabled()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Other edit')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Edit discussion overview' }))
  expect(screen.getByLabelText('Summary')).toHaveValue('Other edit')
})

it('clears overview, draft and history when returning after membership was revoked', async () => {
  queryHyloAPI.mockResolvedValueOnce(ok('discussionOverview', result()))
    .mockResolvedValueOnce({ errors: [{ extensions: { code: 'DISCUSSION_ACCESS_DENIED' } }] })
  render(<DiscussionOverview postId='1' />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit discussion overview' }))
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Discussion overview' })).not.toBeInTheDocument())
})

it('does not display a previous discussion when an old response arrives late', async () => {
  let resolveFirst
  queryHyloAPI.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
    .mockResolvedValueOnce(ok('discussionOverview', result(false, revision(1, 'Second discussion'))))
  const { rerender } = render(<DiscussionOverview postId='1' />)
  rerender(<DiscussionOverview postId='2' />)
  expect(await screen.findByText('Second discussion')).toBeInTheDocument()
  resolveFirst(ok('discussionOverview', result()))
  await waitFor(() => expect(screen.queryByText('Shared evidence')).not.toBeInTheDocument())
})

it('renders submitted markup as text and retains a draft after network failure', async () => {
  queryHyloAPI.mockResolvedValueOnce(ok('discussionOverview', result(true, revision(1, '<img src=x onerror=alert(1)>'))))
    .mockRejectedValueOnce(new Error('network failure'))
  render(<DiscussionOverview postId='1' />)
  expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(document.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Edit discussion overview' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save overview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Your draft has been kept')
  expect(screen.getByLabelText('Summary')).toHaveValue('<img src=x onerror=alert(1)>')
})
