exports.up = knex => knex.schema.createTable('external_oidc_identities', table => {
  table.string('issuer', 512).notNullable()
  table.string('subject', 255).notNullable()
  table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
  table.primary(['issuer', 'subject'])
  table.index('user_id')
})

exports.down = knex => knex.schema.dropTable('external_oidc_identities')
