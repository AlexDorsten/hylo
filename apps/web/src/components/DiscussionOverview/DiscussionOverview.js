import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { queryHyloAPI } from 'util/graphql'

const revisionFields = 'version context summary openQuestions createdAt author { id name }'
const overviewFields = `canEdit current { ${revisionFields} } lastSummary { version createdAt author { id name } }`
const readQuery = `query DiscussionOverview($postId: ID!) { discussionOverview(postId: $postId) { ${overviewFields} } }`
const historyQuery = `query DiscussionHistory($postId: ID!, $beforeVersion: Int) { discussionHistory(postId: $postId, beforeVersion: $beforeVersion) { ${revisionFields} } }`
const saveMutation = `mutation UpdateDiscussion($postId: ID!, $expectedVersion: Int!, $context: String!, $summary: String!, $openQuestions: [String!]!) {
  updateDiscussion(postId: $postId, expectedVersion: $expectedVersion, context: $context, summary: $summary, openQuestions: $openQuestions) { ${overviewFields} }
}`

async function request (query, variables, field) {
  const result = await queryHyloAPI({ query, variables })
  if (result.errors?.length) throw new Error(result.errors[0].extensions?.code || 'DISCUSSION_REQUEST_FAILED')
  if (result.data?.[field] == null) throw new Error('DISCUSSION_ACCESS_DENIED')
  return result.data[field]
}

const buttonClass = 'rounded-md border border-foreground/30 px-3 py-2 text-sm hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50'
const textClass = 'whitespace-pre-wrap break-words text-sm leading-relaxed'

export default function DiscussionOverview ({ postId }) {
  const { t, i18n } = useTranslation()
  const [overview, setOverview] = useState(null)
  const [draft, setDraft] = useState(null)
  const [history, setHistory] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const generation = useRef(0)
  const refreshSequence = useRef(0)
  const editButton = useRef(null)
  const wasEditing = useRef(false)

  const handleError = useCallback(err => {
    if (err.message === 'DISCUSSION_ACCESS_DENIED') {
      ++generation.current
      setOverview(null)
      setDraft(null)
      setHistory(null)
      setError(null)
      setBusy(false)
      setSaved(false)
    } else {
      setError(err.message === 'DISCUSSION_CONFLICT' ? 'conflict' : 'request')
    }
  }, [])

  const refresh = useCallback(async () => {
    const currentGeneration = generation.current
    const sequence = ++refreshSequence.current
    try {
      const next = await request(readQuery, { postId }, 'discussionOverview')
      if (currentGeneration !== generation.current || sequence !== refreshSequence.current) return
      setOverview(previous => previous?.current.version > next.current.version ? { ...previous, canEdit: next.canEdit } : next)
      if (!next.canEdit) setDraft(null)
    } catch (err) {
      if (currentGeneration === generation.current && sequence === refreshSequence.current) handleError(err)
    }
  }, [postId, handleError])

  useEffect(() => {
    ++generation.current
    setOverview(null)
    setDraft(null)
    setHistory(null)
    setError(null)
    setSaved(false)
    setBusy(false)
    refresh()
    // Re-check membership when returning; keep a draft's original version.
    window.addEventListener('focus', refresh)
    return () => { ++generation.current; window.removeEventListener('focus', refresh) }
  }, [postId, refresh])

  useEffect(() => {
    if (draft) wasEditing.current = true
    else if (!busy && wasEditing.current) {
      editButton.current?.focus()
      wasEditing.current = false
    }
  }, [draft, busy])

  const attribution = revision => t('Discussion revision attribution', {
    version: revision.version,
    name: revision.author?.name || t('Former member'),
    date: new Date(revision.createdAt).toLocaleString(i18n.language)
  })

  async function save (event) {
    event.preventDefault()
    const questions = draft.questions.split('\n').map(line => line.trim()).filter(Boolean)
    if (questions.length > 30 || questions.some(question => question.length > 1000)) {
      setError('questions')
      return
    }
    const currentGeneration = generation.current
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await request(saveMutation, {
        postId, expectedVersion: draft.version, context: draft.context, summary: draft.summary, openQuestions: questions
      }, 'updateDiscussion')
      if (currentGeneration !== generation.current) return
      setOverview(next)
      setDraft(null)
      setHistory(null)
      setSaved(true)
    } catch (err) {
      if (currentGeneration !== generation.current) return
      handleError(err)
      if (err.message === 'DISCUSSION_CONFLICT') await refresh()
    } finally {
      if (currentGeneration === generation.current) setBusy(false)
    }
  }

  async function loadHistory () {
    const currentGeneration = generation.current
    setBusy(true)
    setError(null)
    try {
      const rows = await request(historyQuery, { postId, beforeVersion: history?.at(-1)?.version }, 'discussionHistory')
      if (currentGeneration !== generation.current) return
      setHistory(previous => [...(previous || []), ...rows])
      setHasMore(rows.length === 20)
    } catch (err) {
      if (currentGeneration === generation.current) handleError(err)
    } finally {
      if (currentGeneration === generation.current) setBusy(false)
    }
  }

  if (!overview && !error) return null
  return (
    <section aria-label={t('Discussion overview')} className='mx-4 my-6 rounded-xl border border-foreground/20 bg-background p-4 sm:p-5'>
      <h2 className='mb-2 text-lg font-semibold'>{t('Discussion overview')}</h2>
      <p className='mb-4 text-sm text-foreground/80'>{t('Discussion overview introduction')}</p>
      {error && <p role='alert' className='my-3 text-sm'>{t(error === 'conflict' ? 'Discussion conflict help' : error === 'questions' ? 'Discussion questions help' : 'Discussion request failed')}</p>}
      {error === 'request' && <button type='button' className={buttonClass} onClick={() => { setError(null); refresh() }}>{t('Retry')}</button>}
      {saved && <p role='status' className='my-3 text-sm'>{t('Discussion overview saved')}</p>}
      {overview && (
        <>
          {!draft && (
            <div className='space-y-4'>
              {overview.current.version === 0 && <p className='text-sm italic'>{t('Discussion imported context')}</p>}
              <RevisionContent revision={overview.current} />
              {overview.lastSummary && <p className='text-sm' data-testid='discussion-summary-marker'>{t('Latest summary')}: {attribution(overview.lastSummary)}</p>}
            </div>
          )}
          <div className='my-4 flex flex-wrap gap-2'>
            {overview.canEdit && <button ref={editButton} type='button' className={buttonClass} onClick={() => { setDraft({ ...overview.current, questions: overview.current.openQuestions.join('\n') }); setError(null); setSaved(false) }} disabled={busy || !!draft}>{t('Edit discussion overview')}</button>}
            {overview.current.version > 0 && <button type='button' className={buttonClass} onClick={() => history ? setHistory(null) : loadHistory()} disabled={busy} aria-expanded={!!history}>{t(history ? 'Hide revision history' : 'Show revision history')}</button>}
          </div>
          {draft && (
            <form onSubmit={save} className='editingContainer space-y-4'>
              <p className='text-sm'>{t('Discussion editor help')}</p>
              <label className='block'>
                <span className='mb-1 block font-semibold'>{t('Discussion context')}</span>
                <textarea autoFocus rows={5} maxLength={50000} value={draft.context} onChange={event => setDraft({ ...draft, context: event.target.value })} disabled={busy} className='w-full rounded border border-foreground/40 bg-background p-2 text-base' />
              </label>
              <label className='block'>
                <span className='mb-1 block font-semibold'>{t('Discussion summary')}</span>
                <textarea rows={4} maxLength={20000} value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} disabled={busy} className='w-full rounded border border-foreground/40 bg-background p-2 text-base' />
              </label>
              <label className='block'>
                <span className='mb-1 block font-semibold'>{t('Open questions')}</span>
                <span className='mb-1 block text-sm'>{t('Discussion questions help')}</span>
                <textarea rows={3} maxLength={30030} value={draft.questions} onChange={event => setDraft({ ...draft, questions: event.target.value })} disabled={busy} className='w-full rounded border border-foreground/40 bg-background p-2 text-base' />
              </label>
              <div className='flex flex-wrap gap-2'>
                <button type='submit' className={buttonClass} disabled={busy || error === 'conflict'}>{t('Save overview')}</button>
                <button type='button' className={buttonClass} disabled={busy} onClick={() => { setDraft(null); setError(null); editButton.current?.focus() }}>{t('Cancel')}</button>
              </div>
            </form>
          )}
          {history && (
            <div className='mt-4 space-y-3' aria-label={t('Revision history')}>
              <h3 className='font-semibold'>{t('Revision history')}</h3>
              {history.map(revision => (
                <details key={revision.version} className='rounded border border-foreground/20 p-3'>
                  <summary className='cursor-pointer text-sm'>{attribution(revision)}</summary>
                  <div className='mt-3 space-y-3'><RevisionContent revision={revision} /></div>
                </details>
              ))}
              {hasMore && <button type='button' className={buttonClass} disabled={busy} onClick={loadHistory}>{t('Load older revisions')}</button>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RevisionContent ({ revision }) {
  const { t } = useTranslation()
  return (
    <>
      <div><h3 className='mb-1 font-semibold'>{t('Discussion context')}</h3><p className={textClass}>{revision.context || t('No context yet')}</p></div>
      <div><h3 className='mb-1 font-semibold'>{t('Discussion summary')}</h3><p className={textClass}>{revision.summary || t('No summary yet')}</p></div>
      <div>
        <h3 className='mb-1 font-semibold'>{t('Open questions')}</h3>
        {revision.openQuestions.length
          ? <ul className='list-disc space-y-1 pl-5'>{revision.openQuestions.map((question, index) => <li key={index} className={textClass}>{question}</li>)}</ul>
          : <p className={textClass}>{t('No open questions recorded')}</p>}
      </div>
    </>
  )
}
