/* eslint key-spacing:0 */

/**
 * Policy Mappings
 * (sails.config.policies)
 *
 * Policies are simple functions which run **before** your controllers.
 * You can apply one or more policies to a given controller, or protect
 * its actions individually.
 *
 * Any policy file (e.g. `api/policies/authenticated.js`) can be accessed
 * below by its filename, minus the extension, (e.g. "authenticated")
 *
 * For more information on how policies work, see:
 * http://sailsjs.org/#/documentation/concepts/Policies
 *
 * For more information on configuring policies, check out:
 * http://sailsjs.org/#/documentation/reference/sails.config/sails.config.policies.html
 */

module.exports.policies = {
  '*': false,

  InstanceController: { capabilities: true },
  PasswordRecoveryController: { show: true, complete: true },

  AdminController: {
    stripeAnalytics: ['isAdmin', 'paymentsEnabled'],
    setStripeSalesPaused: ['isAdmin', 'paymentsEnabled'],
    '*': 'isAdmin'
  },

  MobileAppController: {
    '*': true
  },

  ExternalOidcController: {
    capabilities: true,
    start: true,
    callback: true,
    link: 'sessionAuth'
  },

  SessionController: {
    createWithJWT: ['checkJWT'],
    startGoogleOAuth: 'enabledLoginProvider',
    finishGoogleOAuth: 'enabledLoginProvider',
    finishGoogleTokenOAuth: 'enabledLoginProvider',
    startLinkedinOAuth: 'enabledLoginProvider',
    finishLinkedinOAuth: 'enabledLoginProvider',
    finishLinkedinTokenOAuth: 'enabledLoginProvider',
    startFacebookOAuth: 'enabledLoginProvider',
    finishFacebookOAuth: 'enabledLoginProvider',
    finishFacebookTokenOAuth: 'enabledLoginProvider',
    finishAppleOAuth: 'enabledLoginProvider',

    '*': true
  },

  SubscriptionController: {
    '*': 'paymentsEnabled'
  },

  CookieConsentController: {
    '*': true
  },

  UploadController: {
    '*': 'sessionAuth'
  },

  ExportController: {
    '*': 'sessionAuth'
  },

  AdminSessionController: {
    create:  true,
    oauth:   true,
    destroy: true
  },

  CommentController: {
    createFromEmail: true,
    createBatchFromEmailForm: ['checkAndDecodeToken']
  },

  GroupController: {
    subscribe:   ['isSocket', 'sessionAuth', 'checkAndSetMembership'],
    unsubscribe: ['isSocket', 'sessionAuth', 'checkAndSetMembership'],
    typing:      ['isSocket', 'sessionAuth', 'checkAndSetMembership']
  },

  MurmurationsController: {
    group: true
  },

  PostController: {
    updateLastRead:         ['sessionAuth', 'checkAndSetPost'],
    subscribe:              ['isSocket', 'sessionAuth', 'checkAndSetPost'],
    unsubscribe:            ['isSocket', 'sessionAuth', 'checkAndSetPost'],
    typing:                 ['isSocket', 'sessionAuth', 'checkAndSetPost'],
    createFromEmailForm:    ['checkAndDecodeToken']
  },

  UserController: {
    create: ['checkClientCredentials'],
    getNotificationSettings: true,
    updateNotificationSettings: true,

    subscribeToUpdates:     ['isSocket', 'sessionAuth'],
    unsubscribeFromUpdates: ['isSocket', 'sessionAuth']
  },

  PaymentController: {
    registerStripe: ['sessionAuth', 'paymentsEnabled']
  },

  StripeController: {
    webhook: 'paymentsEnabled',
    checkoutSuccess: 'paymentsEnabled',
    checkoutCancel: 'paymentsEnabled',
    health: 'paymentsEnabled'
  }
}
