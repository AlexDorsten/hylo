// Identity ownership is immutable. The unique database key and transaction
// enforce this even when callbacks from different sessions race.
async function resolveIdentity (knex, identity, linkingUserId) {
  return knex.transaction(async trx => {
    if (linkingUserId) {
      const user = await trx('users').where({ id: linkingUserId, active: true, email_validated: true }).forUpdate().first()
      if (!user) throw new Error('Account unavailable')
      const password = await trx('linked_account').where({ user_id: linkingUserId, provider_key: 'password' }).first()
      if (!password) throw new Error('Local recovery login required')
      await trx.raw(`INSERT INTO external_oidc_identities (issuer, subject, user_id)
        VALUES (?, ?, ?) ON CONFLICT (issuer, subject) DO NOTHING`, [identity.issuer, identity.subject, linkingUserId])
    }
    const row = await trx('external_oidc_identities').where({ issuer: identity.issuer, subject: identity.subject }).first()
    if (!row || (linkingUserId && String(row.user_id) !== String(linkingUserId))) throw new Error('Identity unavailable')
    const user = await trx('users').where({ id: row.user_id, active: true, email_validated: true }).first()
    if (!user) throw new Error('Account unavailable')
    return String(user.id)
  })
}

module.exports = { resolveIdentity }
