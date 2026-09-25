const { explicitId } = require('../../lib/authentication.cjs')

module.exports = {
  isSignedIn: req => explicitId(req.session?.userId, process.env.HYLO_ADMINS),

  isSuperAdmin: async userId => {
    if (!explicitId(userId, process.env.HYLO_ADMINS)) return false
    return !!(await User.find(userId))
  },

  isTestAdmin: async userId => {
    if (!explicitId(userId, process.env.HYLO_TESTER_IDS) && !explicitId(userId, process.env.HYLO_ADMINS)) return false
    return !!(await User.find(userId))
  }
}
