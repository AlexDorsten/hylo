import React from 'react'
import orm from 'store/models'
import { act, AllTheProviders, render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import useDraft from 'hooks/useDraft'
import CommentForm from './CommentForm'

jest.mock('hooks/useDraft', () => ({
  ...jest.requireActual('hooks/useDraft'),
  __esModule: true,
  default: jest.fn()
}))

let draftState
beforeEach(() => {
  draftState = { loadedData: null, isLoaded: false, saveDraft: jest.fn(), flushSaveDraft: jest.fn(), clearDraft: jest.fn() }
  useDraft.mockImplementation(() => draftState)
})

function providersWithUser (user = { id: '1', name: 'Jen Smith', avatarUrl: 'foo.png' }) {
  const ormSession = orm.mutableSession(orm.getEmptyState())
  if (user) ormSession.Me.create(user)
  return AllTheProviders({ orm: ormSession.state })
}

describe('CommentForm', () => {
  it.each([
    ['comment', undefined, null],
    ['comment', undefined, '<p>Old saved draft</p>'],
    ['reply', '', null],
    ['reply', '', '<p>Old saved draft</p>']
  ])('preserves a %s typed before hydration (prefill %s, saved %s)', async (kind, editorContent, loadedData) => {
    const props = { postId: 'new', editorContent, createComment: jest.fn() }
    const { container, rerender } = render(<CommentForm {...props} />, { wrapper: providersWithUser() })
    const editorElement = container.querySelector('.ProseMirror')
    await waitFor(() => expect(editorElement.editor.isInitialized).toBe(true))
    // Drive the actual Tiptap editor while the draft request is still pending.
    act(() => editorElement.editor.commands.insertContent('My new contribution'))
    expect(draftState.saveDraft).toHaveBeenCalledWith('<p>My new contribution</p>')
    draftState = { ...draftState, isLoaded: true, loadedData }
    rerender(<CommentForm {...props} />)
    expect(editorElement).toHaveTextContent('My new contribution')
  })

  it('does not resurrect a draft after the user has typed and cleared the editor', async () => {
    const props = { postId: 'new', createComment: jest.fn() }
    const { container, rerender } = render(<CommentForm {...props} />, { wrapper: providersWithUser() })
    const editorElement = container.querySelector('.ProseMirror')
    await waitFor(() => expect(editorElement.editor.isInitialized).toBe(true))
    act(() => editorElement.editor.commands.insertContent('Discard this'))
    await act(async () => editorElement.editor.commands.clearContent(true))
    draftState = { ...draftState, isLoaded: true, loadedData: '<p>Old saved draft</p>' }
    rerender(<CommentForm {...props} />)
    expect(editorElement.textContent).toBe('')
    expect(editorElement.editor.isEmpty).toBe(true)
  })

  it('restores a saved draft when the editor has not been changed', async () => {
    const props = { postId: 'new', createComment: jest.fn() }
    const { container, rerender } = render(<CommentForm {...props} />, { wrapper: providersWithUser() })
    const editorElement = container.querySelector('.ProseMirror')
    await waitFor(() => expect(editorElement.editor.isInitialized).toBe(true))
    draftState = { ...draftState, isLoaded: true, loadedData: '<p>Old saved draft</p>' }
    rerender(<CommentForm {...props} />)
    expect(editorElement).toHaveTextContent('Old saved draft')
  })

  it('renders correctly with current user', () => {
    render(
      <CommentForm postId='new' createComment={jest.fn()} />,
      { wrapper: providersWithUser() }
    )

    expect(screen.getByRole('img').getAttribute('style')).toContain('background-image: url(foo.png)')
    expect(screen.getByTestId('upload-button')).toBeInTheDocument()
  })

  it('renders correctly without current user', () => {
    render(
      <CommentForm postId='new' createComment={jest.fn()} />,
      { wrapper: providersWithUser(null) }
    )

    expect(screen.getByTestId('icon-Person')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign up to reply' })).toBeInTheDocument()
    expect(screen.queryByTestId('upload-button')).not.toBeInTheDocument()
  })
})
