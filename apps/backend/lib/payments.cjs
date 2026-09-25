// One runtime capability for REST, GraphQL, jobs and the browser.
const { GraphQLError } = require('graphql')

function paymentsEnabled (env = process.env) {
  const value = env.HYLO_PAYMENTS_ENABLED
  if (value && value !== 'true' && value !== 'false') throw new Error('HYLO_PAYMENTS_ENABLED must be true or false')
  const enabled = value ? value === 'true' : !!env.STRIPE_SECRET_KEY
  if (enabled && !env.STRIPE_SECRET_KEY) throw new Error('Payments require STRIPE_SECRET_KEY')
  return enabled
}

function requirePayments () {
  if (!paymentsEnabled()) {
    const error = new GraphQLError('Payments are disabled on this instance', { extensions: { code: 'PAYMENTS_DISABLED' } })
    error.code = 'PAYMENTS_DISABLED'
    throw error
  }
}

// Lazy initialization lets the API and worker load without any Stripe account.
function stripeClient (options) {
  let client
  return new Proxy({}, {
    get (_target, key) {
      requirePayments()
      client ||= new (require('stripe'))(process.env.STRIPE_SECRET_KEY, options)
      const value = client[key]
      return typeof value === 'function' ? value.bind(client) : value
    }
  })
}

const paymentFields = new Set([
  'stripeAccountStatus', 'stripeOfferings', 'publicStripeOfferings', 'publicStripeOffering',
  'offeringSubscriptionStats', 'offeringSubscribers', 'myTransactions',
  'membershipChangeEligibleOfferings', 'membershipChangePreview', 'membershipChangeInvoicePreview',
  'grantContentAccess', 'revokeContentAccess', 'refundContentAccess', 'recordStripePurchase',
  'processStripeToken', 'registerStripeAccount', 'updateStripeAccount',
  'createStripeConnectedAccount', 'createStripeAccountLink', 'createStripeOffering', 'updateStripeOffering',
  'createStripeCheckoutSession', 'checkStripeStatus', 'fulfillStripeCheckoutSession', 'membershipChangeCommit'
])

function paymentResolvers (resolvers) {
  return Object.fromEntries(Object.entries(resolvers).map(([name, resolver]) => [name,
    paymentFields.has(name)
      ? (...args) => { requirePayments(); return resolver(...args) }
      : resolver
  ]))
}

module.exports = { paymentsEnabled, requirePayments, stripeClient, paymentResolvers }
