import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { seedDiscussion, revokeDiscussionMember, withDatabase } from './helpers/discussionSeed.js'
import { ensureHyloCookieConsent } from './helpers/sessionAuth.js'
import { waitPastRootSessionLoading } from './helpers/waitPastRootSessionLoading.js'

test.describe.configure({ timeout: 240000 })
const uiTimeout = { timeout: 60000 }
const query = 'query ($postId: ID!) { decisionRounds(postId: $postId) { rounds { id phase electorateCount ownBallot { version state answers { optionId score } } result { status complete bestOptionIds options { id total } } } } }'
async function read (page, postId) {
  return (await page.request.post('/noo/graphql', { data: { query, variables: { postId } } })).json()
}
async function login (page, email) {
  await ensureHyloCookieConsent(page)
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('e2e-password-123')
  await page.getByRole('button', { name: /sign\s*in/i }).click()
  await expect(page.locator('#center-column-container')).toBeVisible(uiTimeout)
}
async function score (panel, values) {
  const selects = panel.getByRole('group', { name: 'Your ballot' }).getByRole('combobox')
  await expect(selects).toHaveCount(3)
  for (let i = 0; i < 3; i++) await selects.nth(i).selectOption(String(values[i]))
  await panel.getByRole('button', { name: 'Save complete ballot' }).click()
  await expect(panel.getByText('Your complete ballot is saved. You can replace it until the deadline or closure.')).toBeVisible()
}

test('decision rounds: private SK lifecycle, three voters, replacement, withdrawal, history and translated results', async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_ISOLATED !== '1', 'Requires isolated synthetic data')
  const fixture = await seedDiscussion()
  const third = await withDatabase(async client => {
    const email = `decision-${randomUUID().slice(0, 8)}@hylo.test`
    const row = (await client.query("INSERT INTO users (email,name,active,email_validated,settings) VALUES ($1,'Third Participant',true,true,'{\"locale\":\"en\"}') RETURNING id", [email])).rows[0]
    await client.query("INSERT INTO linked_account (user_id,provider_user_id,provider_key) SELECT $1,provider_user_id,provider_key FROM linked_account WHERE user_id=$2 AND provider_key='password'", [row.id, fixture.memberId])
    await client.query('INSERT INTO group_memberships (group_id,user_id,active,settings) SELECT group_id,$1,true,settings FROM group_memberships WHERE group_id=$2 AND user_id=$3', [row.id, fixture.groupId, fixture.memberId])
    return { memberId: String(row.id), email }
  })
  const path = `/groups/${fixture.slug}/post/${fixture.postId}`
  await page.goto(path); await waitPastRootSessionLoading(page)
  const panel = page.getByRole('region', { name: 'Decision rounds', exact: true })
  await panel.getByRole('button', { name: 'Prepare decision round' }).click(uiTimeout)
  await expect(panel.getByLabel('Question for this round')).toBeFocused()
  await panel.getByLabel('Question for this round').fill('Which venue should host our workshop?')
  await panel.getByLabel('Alternative 1', { exact: true }).fill('Community room')
  await panel.getByLabel('Passive option', { exact: true }).fill('Keep meeting online')
  await panel.getByRole('button', { name: 'Add alternative', exact: true }).click()
  await panel.getByLabel('Alternative 2', { exact: true }).fill('Library')
  await panel.getByLabel('How will the result be used?').fill('Discuss the concerns before deciding together.')
  await panel.getByLabel('Minimum complete ballots').fill('3')
  await panel.getByRole('button', { name: 'Save round draft' }).click()
  await expect(panel.getByText(/Opening freezes the question/)).toBeVisible(uiTimeout)
  await panel.getByRole('button', { name: 'Open voting', exact: true }).click()
  await panel.getByRole('button', { name: 'Confirm round action' }).click()
  const ballots = panel.getByRole('group', { name: 'Your ballot' })
  await expect(ballots.getByRole('combobox').first()).toHaveValue('', uiTimeout)
  await panel.getByRole('button', { name: 'Save complete ballot' }).click()
  expect((await read(page, fixture.postId)).data.decisionRounds.rounds[0].ownBallot.version).toBe(0)
  // Explicit zero entered using the keyboard, without a preselected default.
  await ballots.getByRole('combobox').first().focus()
  await page.keyboard.press('0'); await page.keyboard.press('Tab')
  await expect(ballots.getByRole('combobox').first()).toHaveValue('0')
  await score(panel, [0, 3, 5])
  const own = (await read(page, fixture.postId)).data.decisionRounds.rounds[0]
  expect(own.result).toBeNull()
  expect(own.electorateCount).toBe(3)
  await page.reload()
  await expect(panel.getByRole('combobox').first()).toHaveValue('0', uiTimeout)

  const contexts = []
  try {
    for (const [person, values] of [[fixture, [4, 3, 5]], [third, [8, 3, 5]]]) {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: page.viewportSize() })
      contexts.push(context)
      const memberPage = await context.newPage()
      await login(memberPage, person.email)
      await memberPage.goto(path)
      const memberPanel = memberPage.getByRole('region', { name: 'Decision rounds', exact: true })
      await expect(memberPanel.getByRole('combobox').first()).toHaveValue('', uiTimeout)
      await expect(memberPanel.getByRole('button', { name: 'Close and publish results' })).toHaveCount(0)
      await score(memberPanel, [2, 2, 2])
      await memberPanel.getByRole('button', { name: 'Withdraw my ballot' }).click()
      await expect(memberPanel.getByText('Your ballot is withdrawn.')).toBeVisible()
      await memberPanel.getByRole('button', { name: 'Abstain', exact: true }).click()
      await expect(memberPanel.getByText(/Your abstention is saved/)).toBeVisible()
      await score(memberPanel, values)
      const memberRead = (await read(memberPage, fixture.postId)).data.decisionRounds.rounds[0]
      expect(memberRead.ownBallot.version).toBe(4)
      expect(memberRead.result).toBeNull()
      if (person === third) {
        await revokeDiscussionMember({ groupId: fixture.groupId, memberId: third.memberId })
        await memberPage.evaluate(() => window.dispatchEvent(new Event('focus')))
        await expect(memberPanel).toHaveCount(0)
        expect((await read(memberPage, fixture.postId)).errors[0].extensions.code).toBe('DECISION_ACCESS_DENIED')
      }
    }
    const outsiderContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    contexts.push(outsiderContext)
    const outsider = await outsiderContext.newPage()
    await login(outsider, 'e2e.nogroups@hylo.test')
    expect((await read(outsider, fixture.postId)).errors[0].extensions.code).toBe('DECISION_ACCESS_DENIED')

    await panel.getByRole('button', { name: 'Close and publish results' }).click()
    await panel.getByRole('button', { name: 'Confirm round action' }).click()
    const result = panel.getByRole('region', { name: 'Round result', exact: true })
    await expect(result.getByText('Assessment complete')).toBeVisible(uiTimeout)
    await expect(result.getByRole('row', { name: 'Library 9 3', exact: true })).toBeVisible()
    await expect(result.getByRole('row', { name: 'Community room 12 4', exact: true })).toBeVisible()
    await expect(result.getByText(/Eligible: 3 · Complete: 3/)).toBeVisible()
    await page.reload()
    await expect(result.getByText('Assessment complete')).toBeVisible(uiTimeout)
    await result.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await result.screenshot({ path: testInfo.outputPath('decision-result.png') })
    for (const locale of ['de', 'es', 'fr', 'pt', 'hi', 'en']) {
      const translations = JSON.parse(await readFile(new URL(`../public/locales/${locale}.json`, import.meta.url), 'utf8'))
      await page.evaluate(async language => {
        // eslint-disable-next-line import/no-absolute-path
        const { default: i18n } = await import('/src/i18n.mjs')
        await i18n.changeLanguage(language)
      }, locale)
      const localized = page.getByRole('region', { name: translations['Decision rounds'], exact: true })
      await expect(localized.getByText(translations['Decision human outcome'])).toBeVisible()
      expect(await localized.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (locale === 'de') {
        const translatedResult = localized.getByRole('region', { name: translations['Decision result'], exact: true })
        await translatedResult.evaluate(el => el.scrollIntoView({ block: 'center' }))
        await translatedResult.screenshot({ path: testInfo.outputPath('decision-result-de.png') })
      }
    }
    await panel.getByRole('button', { name: 'Prepare a new linked round' }).click()
    await panel.getByLabel('Question for this round').fill('Which venue after addressing access concerns?')
    await panel.getByLabel('Minimum complete ballots').fill('2')
    await panel.getByRole('button', { name: 'Save round draft' }).click()
    await expect(panel.getByTestId('decision-round')).toHaveCount(2)
    const rounds = (await read(page, fixture.postId)).data.decisionRounds.rounds
    expect(rounds[0].ownBallot.version).toBe(0)
    expect(rounds[1].result.options.map(o => o.total)).toEqual([9, 12, 15])
  } finally { for (const context of contexts) await context.close() }
})
