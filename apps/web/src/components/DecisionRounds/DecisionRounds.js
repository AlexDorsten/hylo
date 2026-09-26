import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { queryHyloAPI } from 'util/graphql'

const fields = `id version phase previousRoundId electorateCount createdAt openedAt closedAt canManage canVote eligible
  config { method question purpose minimum deadline options { id label passive } }
  ownBallot { version state answers { optionId score } }
  result { status eligible complete abstentions missing bestOptionIds options { id label passive total mean distribution } }`
const readQuery = `query DecisionRounds($postId: ID!, $beforeId: ID) { decisionRounds(postId: $postId, beforeId: $beforeId) { canCreate eligibleCount hasMore rounds { ${fields} } } }`
const manageMutation = `mutation ManageDecisionRound($input: ManageDecisionInput!) { manageDecisionRound(input: $input) { ${fields} } }`
const ballotMutation = `mutation SubmitDecisionBallot($input: DecisionBallotInput!) { submitDecisionBallot(input: $input) { ${fields} } }`
const button = 'rounded-md border border-foreground/30 px-3 py-2 text-sm hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50'
const control = 'block w-full rounded border border-foreground/30 bg-background p-2'
const text = 'whitespace-pre-wrap break-words text-sm leading-relaxed'

async function request (query, variables, field) {
  const response = await queryHyloAPI({ query, variables })
  if (response.errors?.length) throw new Error(response.errors[0].extensions?.code || 'DECISION_REQUEST_FAILED')
  if (!response.data?.[field]) throw new Error('DECISION_ACCESS_DENIED')
  return response.data[field]
}
const localDate = iso => {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function Editor ({ initial, busy, onSave, onCancel }) {
  const { t } = useTranslation()
  const [config, setConfig] = useState(() => initial || {
    method: 'systemic_consensus',
    question: '',
    purpose: '',
    minimum: 1,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    options: [
      { id: crypto.randomUUID(), label: '', passive: false }, { id: crypto.randomUUID(), label: '', passive: true }
    ]
  })
  const update = changes => setConfig(previous => ({ ...previous, ...changes }))
  const setOption = (id, changes) => update({ options: config.options.map(o => o.id === id ? { ...o, ...changes } : o) })
  const sk = config.method === 'systemic_consensus'
  return (
    <form className='space-y-3' onSubmit={event => { event.preventDefault(); onSave(config) }}>
      <label className='block'>{t('Decision question')}<textarea autoFocus required maxLength={2000} className={control} value={config.question} onChange={e => update({ question: e.target.value })} /></label>
      <label className='block'>{t('Decision method')}
        <select
          className={control} value={config.method} onChange={e => {
            const method = e.target.value
            update({ method, options: config.options.map((o, i) => ({ ...o, passive: method === 'systemic_consensus' && i === config.options.length - 1 })) })
          }}
        >
          <option value='systemic_consensus'>{t('Systemic consensus')}</option>
          <option value='single_choice'>{t('Decision single choice')}</option>
        </select>
      </label>
      {config.options.map((option, index) => (
        <div key={option.id} className='flex items-end gap-2'>
          <label className='min-w-0 flex-1'>{option.passive ? t('Decision passive option') : t('Decision alternative', { number: index + 1 })}
            <input required maxLength={1000} className={control} value={option.label} onChange={e => setOption(option.id, { label: e.target.value })} />
          </label>
          {!option.passive && config.options.length > 2 && <button className={button} type='button' aria-label={t('Decision remove alternative', { number: index + 1 })} onClick={() => update({ options: config.options.filter(o => o.id !== option.id) })}>{t('Remove')}</button>}
        </div>
      ))}
      {config.options.length < 20 && (
        <button
          type='button' className={button} onClick={() => {
            const option = { id: crypto.randomUUID(), label: '', passive: false }
            update({ options: sk ? [...config.options.filter(o => !o.passive), option, ...config.options.filter(o => o.passive)] : [...config.options, option] })
          }}
        >{t('Decision add alternative')}
        </button>
      )}
      <label className='block'>{t('Decision use of result')}<textarea required maxLength={4000} className={control} value={config.purpose} onChange={e => update({ purpose: e.target.value })} /></label>
      <label className='block'>{t('Decision deadline', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
        <input type='datetime-local' required className={control} value={localDate(config.deadline)} onChange={e => { if (e.target.value) update({ deadline: new Date(e.target.value).toISOString() }) }} />
      </label>
      <label className='block'>{t('Decision minimum')}<input type='number' required min={1} step={1} className={control} value={config.minimum} onChange={e => update({ minimum: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
      <div className='flex flex-wrap gap-2'><button disabled={busy} className={button}>{t('Decision save draft')}</button><button disabled={busy} type='button' className={button} onClick={onCancel}>{t('Cancel')}</button></div>
    </form>
  )
}

function Ballot ({ round, busy, submit }) {
  const { t } = useTranslation()
  const sk = round.config.method === 'systemic_consensus'
  const [values, setValues] = useState(() => Object.fromEntries(round.ownBallot.answers.map(a => [a.optionId, sk ? String(a.score) : 'selected'])))
  const selected = Object.keys(values)[0] || ''
  const send = state => {
    if (state === 'vote' && (sk ? round.config.options.some(o => values[o.id] == null || values[o.id] === '') : !selected)) return
    submit(state, state !== 'vote'
      ? []
      : sk
        ? round.config.options.map(o => ({ optionId: o.id, score: Number(values[o.id]) }))
        : [{ optionId: selected }])
  }
  return (
    <form onSubmit={event => { event.preventDefault(); send('vote') }} className='mt-4 space-y-3'>
      <fieldset disabled={busy} className='space-y-3'>
        <legend className='font-semibold'>{t('Decision your ballot')}</legend>
        {round.config.options.map(option => (
          <label key={option.id} className='block break-words'>
            {sk
              ? (
                <>{option.label}{option.passive && ` (${t('Decision passive option')})`}
                  <select required className={control} value={values[option.id] ?? ''} onChange={e => setValues(previous => ({ ...previous, [option.id]: e.target.value }))}>
                    <option value=''>{t('Decision unanswered')}</option>
                    {Array.from({ length: 11 }, (_, i) => <option value={i} key={i}>{i}</option>)}
                  </select>
                </>
                )
              : <><input required type='radio' name={`choice-${round.id}`} value={option.id} checked={selected === option.id} onChange={() => setValues({ [option.id]: 'selected' })} className='mr-2' />{option.label}</>}
          </label>
        ))}
        <div className='flex flex-wrap gap-2'>
          <button className={button}>{t('Decision submit ballot')}</button>
          <button className={button} type='button' onClick={() => send('abstained')}>{t('Decision abstain')}</button>
          {['vote', 'abstained'].includes(round.ownBallot.state) && <button className={button} type='button' onClick={() => send('withdrawn')}>{t('Decision withdraw')}</button>}
        </div>
      </fieldset>
    </form>
  )
}

function Round ({ round, eligibleCount, busy, manage, submit, newRound }) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const sk = round.config.method === 'systemic_consensus'
  const supported = sk || round.config.method === 'single_choice'
  const format = value => new Date(value).toLocaleString(i18n.language, { timeZoneName: 'short' })
  const result = round.result
  return (
    <article id={`decision-${round.id}`} data-testid='decision-round' className='my-4 space-y-3 rounded-lg border border-foreground/20 p-3 sm:p-4'>
      <p className='text-sm font-semibold'>{t(`Decision phase ${round.phase}`)} · {supported ? t(sk ? 'Systemic consensus' : 'Decision single choice') : t('Decision unsupported')}</p>
      <h3 className='break-words text-lg font-semibold'>{round.config.question}</h3>
      <p className={text}>{round.config.purpose}</p>
      <p className={text}>{t('Decision rules', { eligible: round.phase === 'draft' ? eligibleCount : round.electorateCount, minimum: round.config.minimum, deadline: format(round.config.deadline) })}</p>
      <p className={text}>{t('Decision privacy')}</p>
      {sk && <p className={text}>{t('Decision scale')}</p>}
      {round.previousRoundId && <p className={text}>{t('Decision follows round')}</p>}
      {editing && round.canManage && round.phase === 'draft'
        ? <Editor initial={round.config} busy={busy} onCancel={() => setEditing(false)} onSave={config => manage('update', round, { config })} />
        : <ul className='list-disc space-y-1 pl-5'>{round.config.options.map(o => <li key={o.id} className={text}>{o.label}{o.passive && ` (${t('Decision passive option')})`}</li>)}</ul>}
      {round.phase === 'draft' && <p className={text}>{t('Decision freeze notice')}</p>}
      {round.phase === 'open' && (
        <>
          <p role='status'>{t(`Decision ballot ${round.ownBallot.state}`)}</p>
          {round.canVote && supported
            ? <Ballot round={round} busy={busy} submit={(state, answers) => submit(round, state, answers)} />
            : <p className={text}>{t(round.eligible ? 'Decision deadline reached' : 'Decision not eligible')}</p>}
          <p className={text}>{t('Decision results after close')}</p>
        </>
      )}
      {round.phase === 'cancelled' && <p className={text}>{t('Decision cancelled notice')}</p>}
      {result && (
        <section aria-label={t('Decision result')} className='space-y-3'>
          <h4 className='font-semibold'>{t(`Decision result ${result.status}`)}</h4>
          <p className={text}>{t('Decision participation', result)}</p>
          <p className={text}>{t('Decision closed at', { date: format(round.closedAt) })}</p>
          <p className={text}>{t('Decision human outcome')}</p>
          <p className={text}>{t('Decision small group')}</p>
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <caption className='sr-only'>{t('Decision result')}</caption>
              <thead><tr><th scope='col' className='p-2'>{t('Decision option')}</th><th scope='col' className='p-2'>{t(sk ? 'Decision total resistance' : 'Decision votes')}</th>{sk && <th scope='col' className='p-2'>{t('Decision mean')}</th>}</tr></thead>
              <tbody>{result.options.map(o => <tr key={o.id} className='border-t border-foreground/20'><th scope='row' className='break-words p-2 font-normal'>{o.label}{o.passive && ` (${t('Decision passive option')})`}</th><td className='p-2'>{o.total}</td>{sk && <td className='p-2'>{o.mean == null ? '—' : o.mean.toLocaleString(i18n.language, { maximumFractionDigits: 2 })}</td>}</tr>)}</tbody>
            </table>
          </div>
          {result.bestOptionIds.length > 0 && <p className={text}>{t('Decision best options', { options: result.options.filter(o => result.bestOptionIds.includes(o.id)).map(o => o.label).join(', ') })}</p>}
          {sk && <details><summary>{t('Decision distribution')}</summary><ul className='space-y-2 py-2'>{result.options.map(o => <li key={o.id} className={text}><strong>{o.label}</strong>: {o.distribution.map((count, score) => `${score}: ${count}`).join(' · ')}</li>)}</ul></details>}
        </section>
      )}
      {round.canManage && !editing && (
        <div className='flex flex-wrap gap-2'>
          {round.phase === 'draft' && <><button className={button} disabled={busy} onClick={() => setEditing(true)}>{t('Decision edit draft')}</button><button className={button} disabled={busy || !supported} onClick={() => setConfirm('open')}>{t('Decision open')}</button></>}
          {round.phase === 'open' && <button className={button} disabled={busy} onClick={() => setConfirm('close')}>{t('Decision close')}</button>}
          {['draft', 'open'].includes(round.phase) && <button className={button} disabled={busy} onClick={() => setConfirm('cancel')}>{t('Decision cancel round')}</button>}
          {['closed', 'cancelled'].includes(round.phase) && <button className={button} disabled={busy} onClick={() => newRound(round)}>{t('Decision follow-up round')}</button>}
        </div>
      )}
      {confirm && round.canManage && (
        <div className='space-y-2 rounded border border-foreground/30 p-3'>
          <p>{t(`Decision confirm ${confirm}`)}</p>
          <div className='flex flex-wrap gap-2'><button className={button} disabled={busy} onClick={() => manage(confirm, round)}>{t('Decision confirm action')}</button><button className={button} disabled={busy} onClick={() => setConfirm(null)}>{t('Cancel')}</button></div>
        </div>
      )}
    </article>
  )
}

export default function DecisionRounds ({ postId }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const generation = useRef(0)
  const sequence = useRef(0)
  const pending = useRef(null)
  const handleError = useCallback(err => {
    if (err.message === 'DECISION_ACCESS_DENIED') {
      ++generation.current
      setData(null); setDraft(null); setError(null); setBusy(false); setSaved(false); pending.current = null
    } else setError(err.message)
  }, [])
  const refresh = useCallback(async (more = false) => {
    const current = generation.current
    const requestSequence = ++sequence.current
    try {
      const next = await request(readQuery, { postId, ...(more ? { beforeId: more } : {}) }, 'decisionRounds')
      if (current !== generation.current || requestSequence !== sequence.current) return
      setData(previous => more ? { ...next, rounds: [...(previous?.rounds || []), ...next.rounds] } : next)
      if (!next.canCreate) setDraft(null)
    } catch (err) { if (current === generation.current && requestSequence === sequence.current) handleError(err) }
  }, [postId, handleError])
  useEffect(() => {
    ++generation.current; setData(null); setDraft(null); setError(null); setBusy(false); setSaved(false); pending.current = null
    refresh()
    const focus = () => refresh()
    window.addEventListener('focus', focus)
    return () => { ++generation.current; window.removeEventListener('focus', focus) }
  }, [refresh])

  async function mutate (kind, payload) {
    if (busy) return
    const current = generation.current
    ++sequence.current // Invalidate reads started before this mutation.
    const signature = JSON.stringify({ kind, payload })
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() }
    const input = { postId, ...payload, requestId: pending.current.requestId }
    setBusy(true); setError(null); setSaved(false)
    try {
      const row = await request(kind === 'manage' ? manageMutation : ballotMutation, { input }, kind === 'manage' ? 'manageDecisionRound' : 'submitDecisionBallot')
      if (current !== generation.current) return
      ++sequence.current
      setData(previous => ({ ...previous, rounds: previous.rounds.some(r => r.id === row.id) ? previous.rounds.map(r => r.id === row.id ? row : r) : [row, ...previous.rounds] }))
      setDraft(null); setSaved(true); pending.current = null
    } catch (err) {
      if (current !== generation.current) return
      handleError(err)
      if (['DECISION_CONFLICT', 'DECISION_DEADLINE_PASSED', 'DECISION_INVALID_STATE', 'DECISION_FROZEN', 'DECISION_NOT_ELIGIBLE'].includes(err.message)) await refresh()
    } finally { if (current === generation.current) setBusy(false) }
  }
  const manage = (action, round, extra = {}) => mutate('manage', { action, roundId: round?.id, expectedVersion: round?.version || 0, ...extra })
  if (!data && !error) return null
  const errorKey = error === 'DECISION_CONFLICT'
    ? 'Decision conflict'
    : ['DECISION_INVALID_CONFIG', 'DECISION_INVALID_BALLOT'].includes(error)
        ? 'Decision invalid input'
        : ['DECISION_DEADLINE_PASSED', 'DECISION_INVALID_STATE', 'DECISION_FROZEN', 'DECISION_NOT_ELIGIBLE'].includes(error) ? 'Decision state changed' : 'Decision request failed'
  return (
    <section aria-label={t('Decision rounds')} className='mx-4 my-6 rounded-xl border border-foreground/20 bg-background p-4 sm:p-5'>
      <h2 className='text-lg font-semibold'>{t('Decision rounds')}</h2>
      <p className={`${text} my-2`}>{t('Decision introduction')}</p>
      {error && <p role='alert' className='my-3'>{t(errorKey)}</p>}
      {saved && <p role='status' className='my-3'>{t('Decision saved')}</p>}
      <div className='flex flex-wrap gap-2'>
        <button className={button} disabled={busy} onClick={() => refresh()}>{t('Decision refresh')}</button>
        {data?.canCreate && !draft && <button className={button} disabled={busy} onClick={() => setDraft({})}>{t('Decision new round')}</button>}
      </div>
      {draft && <div className='my-4'><Editor initial={draft.config} busy={busy} onCancel={() => setDraft(null)} onSave={config => manage('create', null, { config, previousRoundId: draft.previousRoundId })} /></div>}
      {data?.rounds.map(round => <Round
        key={`${round.id}:${round.version}:${round.ownBallot.version}`} round={round} eligibleCount={data.eligibleCount} busy={busy} manage={manage}
        newRound={previous => setDraft({ config: { ...previous.config, deadline: new Date(Date.now() + 86400000).toISOString() }, previousRoundId: previous.id })}
        submit={(row, state, answers) => mutate('ballot', { roundId: row.id, expectedVersion: row.ownBallot.version, state, answers })}
                                 />)}
      {data?.hasMore && <button className={button} disabled={busy} onClick={() => refresh(data.rounds.at(-1).id)}>{t('Decision older rounds')}</button>}
    </section>
  )
}
