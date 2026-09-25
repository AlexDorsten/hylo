import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { seedDiscussion, revokeDiscussionMember } from './helpers/discussionSeed.js'
import { ensureHyloCookieConsent } from './helpers/sessionAuth.js'
import { waitPastRootSessionLoading } from './helpers/waitPastRootSessionLoading.js'

test.describe.configure({ timeout: 180000 })
const uiTimeout = { timeout: 60000 }

async function login (page, email) {
  await ensureHyloCookieConsent(page)
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('e2e-password-123')
  await page.getByRole('button', { name: /sign\s*in/i }).click()
  await expect(page.locator('#center-column-container')).toBeVisible(uiTimeout)
}

async function readPrivateOverview (page, postId) {
  const response = await page.request.post('/noo/graphql', {
    data: { query: 'query($id: ID!) { discussionOverview(postId: $id) { current { summary } } discussionHistory(postId: $id) { summary } }', variables: { id: postId } }
  })
  return response.json()
}

async function captureOverview (page, panel, path) {
  // Keep the actual device width, but include the complete scrollable panel in
  // review evidence instead of clipping it beneath the fixed post header.
  const viewport = page.viewportSize()
  const height = Math.ceil((await panel.boundingBox()).height) + 300
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) })
  await panel.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await panel.screenshot({ path })
  await page.setViewportSize(viewport)
}

test('discussion overview: author, late participant, outsider and revoked member', async ({ page, browser, baseURL }, testInfo) => {
  test.skip(process.env.E2E_ISOLATED !== '1', 'Requires isolated synthetic data')
  const fixture = await seedDiscussion()
  const path = `/groups/${fixture.slug}/post/${fixture.postId}`
  await page.goto(path)
  await waitPastRootSessionLoading(page)
  const panel = page.getByRole('region', { name: 'Discussion overview' })
  await expect(panel).toBeVisible(uiTimeout)
  await expect(panel.getByText(/Original workshop context/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Original evidence', exact: true })).toHaveAttribute('href', 'https://example.org/evidence')

  const edit = panel.getByRole('button', { name: 'Edit discussion overview' })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('textbox', { name: 'Context', exact: true })).toBeFocused()
  await panel.getByRole('textbox', { name: 'Context', exact: true }).fill('Plan a workshop that everyone can attend.')
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('textbox', { name: 'Summary', exact: true })).toBeFocused()
  await panel.getByRole('textbox', { name: 'Summary', exact: true }).fill('We agree to compare accessible venues.')
  await panel.getByRole('textbox', { name: /Open questions/ }).fill('Which venue is accessible?\nWho can help organise?')
  await panel.getByRole('button', { name: 'Save overview' }).click()
  await expect(panel.getByRole('status')).toHaveText('Overview saved.', uiTimeout)
  await page.reload()
  await expect(panel.getByText('We agree to compare accessible venues.')).toBeVisible(uiTimeout)
  await edit.click()
  await panel.getByRole('textbox', { name: 'Summary', exact: true }).fill('Two accessible venues are being compared.')
  await panel.getByRole('button', { name: 'Save overview' }).click()
  await expect(panel.getByRole('status')).toHaveText('Overview saved.', uiTimeout)
  await panel.getByRole('button', { name: 'Show revision history' }).click()
  await expect(panel.locator('details')).toHaveCount(2)
  await panel.locator('details').last().locator('summary').click()
  await expect(panel.getByText('We agree to compare accessible venues.')).toBeVisible()
  await captureOverview(page, panel, testInfo.outputPath('discussion-overview.png'))
  await testInfo.attach('Discussion overview with attributed history', { path: testInfo.outputPath('discussion-overview.png'), contentType: 'image/png' })
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  for (const locale of ['de', 'es', 'fr', 'pt', 'hi', 'en']) {
    const translations = JSON.parse(await readFile(new URL(`../public/locales/${locale}.json`, import.meta.url), 'utf8'))
    await page.evaluate(async locale => {
      // Browser URL served by Vite, not a filesystem import.
      // eslint-disable-next-line import/no-absolute-path
      const { default: i18n } = await import('/src/i18n.mjs')
      await i18n.changeLanguage(locale)
    }, locale)
    const localizedPanel = page.getByRole('region', { name: translations['Discussion overview'] })
    await expect(localizedPanel.getByRole('heading', { name: translations['Open questions'], exact: true }).first()).toBeVisible()
    expect(await localizedPanel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    if (locale === 'de') await captureOverview(page, localizedPanel, testInfo.outputPath('discussion-overview-de.png'))
  }

  const memberContext = await browser.newContext({ baseURL, viewport: page.viewportSize(), storageState: { cookies: [], origins: [] } })
  const outsiderContext = await browser.newContext({ baseURL, viewport: page.viewportSize(), storageState: { cookies: [], origins: [] } })
  try {
    const member = await memberContext.newPage()
    await login(member, fixture.email)
    await member.goto(path)
    const memberPanel = member.getByRole('region', { name: 'Discussion overview' })
    await expect(memberPanel.getByText('Two accessible venues are being compared.')).toBeVisible(uiTimeout)
    await expect(memberPanel.getByRole('button', { name: 'Edit discussion overview' })).toHaveCount(0)
    const composer = member.locator('.CommentForm .ProseMirror[contenteditable="true"]').first()
    await composer.click()
    await expect(composer).toBeFocused()
    await composer.fill('The library has step-free access.')
    await expect(composer).toHaveText('The library has step-free access.')
    const commentResponse = member.waitForResponse(response => response.url().includes('/noo/graphql') && response.request().postData()?.includes('mutation CreateComment'), { timeout: 15000 })
    await member.locator('.CommentForm').first().getByRole('button', { name: 'Send', exact: true }).click()
    const commentResult = await (await commentResponse).json()
    expect(commentResult.errors).toBeUndefined()
    const commentId = commentResult.data.createComment?.id || commentResult.data.comment?.id
    expect(commentId).toBeTruthy()
    await member.goto(`${path}?commentId=${commentId}`)
    await expect(member.getByText('The library has step-free access.', { exact: true })).toBeVisible(uiTimeout)
    await expect(memberPanel.getByText('Two accessible venues are being compared.')).toBeVisible()

    const comment = member.locator('.CommentContainer').filter({ hasText: 'The library has step-free access.' }).first()
    await comment.hover()
    await comment.locator('[data-tooltip-content="Reply"]').click()
    const replyComposer = member.locator('.CommentOuterContainer .CommentForm .ProseMirror[contenteditable="true"]').first()
    // A real user gesture matters: mobile intentionally blurs automatic focus
    // immediately after mounting a composer to avoid opening the keyboard.
    await replyComposer.click()
    await expect(replyComposer).toBeFocused()
    await replyComposer.fill('I can ask the librarian about available dates.')
    await expect(replyComposer).toHaveText('I can ask the librarian about available dates.')
    const replyResponse = member.waitForResponse(response => response.url().includes('/noo/graphql') && response.request().postData()?.includes('mutation CreateComment'), { timeout: 15000 })
    await member.locator('.CommentOuterContainer .CommentForm').first().getByRole('button', { name: 'Send', exact: true }).click()
    const replyResult = await (await replyResponse).json()
    expect(replyResult.errors).toBeUndefined()
    expect(replyResult.data.createComment.parentComment.id).toBe(commentId)
    await member.reload()
    await expect(member.getByText('I can ask the librarian about available dates.', { exact: true })).toBeVisible(uiTimeout)

    const outsider = await outsiderContext.newPage()
    await login(outsider, 'e2e.nogroups@hylo.test')
    const denied = await readPrivateOverview(outsider, fixture.postId)
    expect(denied.data).toEqual({ discussionOverview: null, discussionHistory: null })
    expect(denied.errors.every(error => error.extensions.code === 'DISCUSSION_ACCESS_DENIED')).toBe(true)
    await outsider.goto(`/post/${fixture.postId}`)
    await waitPastRootSessionLoading(outsider)
    await expect(outsider.getByText('Two accessible venues are being compared.')).toHaveCount(0)
    await expect(outsider.getByText('Original workshop context.', { exact: false })).toHaveCount(0)

    await revokeDiscussionMember(fixture)
    const revoked = await readPrivateOverview(member, fixture.postId)
    expect(revoked.data).toEqual({ discussionOverview: null, discussionHistory: null })
    await member.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(memberPanel).toHaveCount(0, uiTimeout)
    await member.reload()
    await expect(memberPanel).toHaveCount(0)
  } finally {
    await Promise.allSettled([memberContext.close(), outsiderContext.close()])
  }
})
