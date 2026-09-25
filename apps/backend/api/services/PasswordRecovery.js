import bcrypt from 'bcrypt'
import { Validators } from '@hylo/shared'
import RedisClient from './RedisClient'
const { configuration } = require('../../lib/authentication.cjs')
const { createRecovery } = require('../../lib/passwordRecovery.cjs')

const recovery = () => createRecovery({
  knex: bookshelf.knex,
  redis: RedisClient.create('password-recovery'),
  origin: configuration().origin,
  validatePassword: Validators.validateUser.password,
  hashPassword: password => bcrypt.hash(password, 10),
  deliver: data => Email.sendPasswordReset(data),
  enqueue: data => Queue.classMethod('PasswordRecovery', 'send', data, 0)
})

module.exports = {
  request: data => recovery().request(data),
  send: data => recovery().send(data),
  complete: data => recovery().complete(data)
}
