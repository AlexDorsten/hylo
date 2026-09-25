import setup from '../../setup'
import factories from '../../setup/factories'
import { mockify, unspyify } from '../../setup/helpers'
import makeSubscriptions from '../../../api/graphql/makeSubscriptions'
import RedisClient from '../../../api/services/RedisClient'
import peopleTyping from '../../../api/graphql/mutations/peopleTyping'
import createComment from '../../../api/models/comment/createComment'
import * as Websockets from '../../../api/services/Websockets'
import { createServer } from 'http'
import { Server } from 'socket.io'
import connect from 'socket.io-client'
import redisAdapter from '@sailshq/socket.io-redis'
import makeJoinRoom from 'sails-hook-sockets/lib/sails.sockets/join-room'
import makeBroadcast from 'sails-hook-sockets/lib/sails.sockets/broadcast-to-room'

describe('Discussion delivery after membership changes', () => {
  let author, member, outsider, group, post, comment, originalSockets, originalEmailNotificationsEnabled
  const memberships = new Map()
  const received = new Map()
  const revoke = () => bookshelf.knex('group_memberships').where({ group_id: group.id, user_id: member.id }).update({ active: false })
  const live = async fn => {
    const env = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try { return await fn() } finally { process.env.NODE_ENV = env }
  }
  const join = user => {
    const req = { session: { userId: user.id } }
    const res = { ok: () => {}, serverError: err => { throw err } }
    Websockets.joinRoom(req, res, 'post', post.id)
  }

  beforeEach(async () => {
    await setup.clearDb()
    mockify(Queue, 'classMethod', () => Promise.resolve())
    originalEmailNotificationsEnabled = process.env.EMAIL_NOTIFICATIONS_ENABLED
    process.env.EMAIL_NOTIFICATIONS_ENABLED = 'true'
    author = await factories.user({ name: 'Workshop Author', email: 'author@example.test' }).save()
    member = await factories.user({ name: 'Workshop Member', email: 'member@example.test' }).save()
    outsider = await factories.user({ name: 'Outside Reader', email: 'outsider@example.test' }).save()
    group = await factories.group({ visibility: 0, active: true }).save()
    for (const user of [author, member]) await user.joinGroup(group)
    post = await factories.post({ user_id: author.id, type: 'discussion', name: 'Private workshop', is_public: false }).save()
    await post.groups().attach(group.id)
    comment = await factories.comment({ post_id: post.id, user_id: author.id, text: 'Private contribution' }).save()
    await factories.postUser({ post_id: post.id, user_id: member.id }).save()
    memberships.clear()
    received.clear()
    originalSockets = sails.sockets
    // Capture only the transport. Room selection, identities, database access,
    // comment creation and notification dispatch use the production code.
    sails.sockets = {
      join: (req, rooms, cb) => {
        for (const room of [].concat(rooms)) {
          if (!memberships.has(room)) memberships.set(room, new Set())
          memberships.get(room).add(req.session.userId)
        }
        cb()
      },
      broadcast: (rooms, type, payload) => {
        const recipients = new Set([].concat(rooms).flatMap(room => [...(memberships.get(room) || [])]))
        for (const id of recipients) received.set(id, [...(received.get(id) || []), { type, payload }])
      }
    }
  })
  afterEach(() => {
    sails.sockets = originalSockets
    if (originalEmailNotificationsEnabled === undefined) delete process.env.EMAIL_NOTIFICATIONS_ENABLED
    else process.env.EMAIL_NOTIFICATIONS_ENABLED = originalEmailNotificationsEnabled
    unspyify(Queue, 'classMethod')
  })

  for (const kind of ['typing', 'comment']) {
    it(`stops ${kind} content reaching a previously joined socket after membership revocation`, async () => {
      join(author)
      join(member)
      const send = () => live(() => kind === 'typing'
        ? post.pushTypingToSockets(author.id, author.get('name'), true)
        : createComment(author.id, { post, text: 'A new private contribution' }))
      await send()
      expect(received.get(member.id)).to.have.length(1)
      received.clear()
      await revoke()
      await send()
      expect(received.get(member.id) || []).to.have.length(0)
      expect(received.get(author.id)).to.have.length(1)
    })
  }

  it('stops delivery through a room joined while the discussion was public', async () => {
    await post.save({ is_public: true })
    join(outsider)
    await live(() => post.pushTypingToSockets(author.id, author.get('name'), true))
    expect(received.get(outsider.id)).to.have.length(1)
    received.clear()
    await bookshelf.knex('posts').where({ id: post.id }).update({ is_public: false })
    await live(() => post.pushTypingToSockets(author.id, author.get('name'), true))
    expect(received.get(outsider.id) || []).to.have.length(0)
  })

  for (const transport of ['Sails', 'Redis worker']) {
    it(`delivers only to current members through the real ${transport} transport`, async () => {
      const http = createServer()
      const io = new Server(http, { allowEIO3: true })
      io.adapter(redisAdapter(process.env.REDIS_URL))
      const adapter = io.of('/').adapter
      const app = { io, log: sails.log, sockets: { parseSocket: req => req?.socket || req } }
      app.sockets.join = makeJoinRoom(app)
      app.sockets.broadcast = makeBroadcast(app)
      sails.sockets = app.sockets
      const clients = []
      const once = (socket, event) => new Promise(resolve => socket.once(event, resolve))
      try {
        await new Promise((resolve, reject) => adapter.subClient.psubscribe(adapter.channel + '*', err => err ? reject(err) : resolve()))
        await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
        io.on('connection', socket => {
          // Synthetic authenticated identities, supplied by this fixture only.
          const userId = socket.handshake.query.userId
          Websockets.joinRoom({ socket, session: { userId } }, {
            ok: () => socket.emit('joined'),
            serverError: err => socket.emit('joinFailed', String(err))
          }, 'post', post.id)
        })
        for (const user of [author, member]) {
          const client = connect(`http://127.0.0.1:${http.address().port}`, {
            transports: ['websocket'], forceNew: true, reconnection: false, query: { userId: user.id }
          })
          clients.push(client)
          await Promise.race([
            once(client, 'joined'),
            once(client, 'connect_error').then(err => { throw err })
          ])
        }
        const memberEvents = []
        clients[1].on('userTyping', event => memberEvents.push(event))
        const send = async () => {
          const delivered = once(clients[0], 'userTyping')
          if (transport === 'Redis worker') sails.sockets = undefined
          try {
            await live(() => post.pushTypingToSockets(author.id, author.get('name'), true))
            await delivered
          } finally { sails.sockets = app.sockets }
          // A subsequent packet on the same connection is an ordering barrier,
          // so absence is asserted without an arbitrary sleep.
          const barrier = once(clients[1], 'deliveryBarrier')
          io.emit('deliveryBarrier')
          await barrier
        }
        await send()
        expect(memberEvents).to.have.length(1)
        await revoke()
        await send()
        expect(memberEvents).to.have.length(1)
      } finally {
        clients.forEach(client => client.disconnect())
        await new Promise(resolve => io.close(resolve))
        await Promise.all([adapter.pubClient, adapter.subClient].map(client => new Promise(resolve => client.quit(resolve))))
      }
    })
  }

  it('retains delivery when membership in another linked group still grants access', async () => {
    const otherGroup = await factories.group({ active: true }).save()
    await member.joinGroup(otherGroup)
    await post.groups().attach(otherGroup.id)
    join(member)
    await revoke()
    await live(() => post.pushTypingToSockets(author.id, author.get('name'), true))
    expect(received.get(member.id)).to.have.length(1)
  })

  for (const resource of ['group', 'user', 'post']) {
    it(`withholds private socket events after the ${resource} becomes inactive`, async () => {
      join(member)
      const model = { group, user: member, post }[resource]
      await model.save({ active: false }, { patch: true })
      await live(() => post.pushTypingToSockets(author.id, author.get('name'), true))
      expect(received.get(member.id) || []).to.have.length(0)
    })
  }

  it('requires current access before publishing typing events', async () => {
    await revoke()
    for (const user of [member, outsider]) {
      const published = []
      const context = { currentUserId: user.id, pubSub: { publish: (...args) => published.push(args) } }
      await expect(peopleTyping(null, { postId: post.id }, context)).to.be.rejectedWith('ACCESS_DENIED')
      expect(published).to.have.length(0)
    }
  })

  it('supports typing in an accessible comment thread', async () => {
    const published = []
    const context = { currentUserId: member.id, pubSub: { publish: (...args) => published.push(args) } }
    expect(await peopleTyping(null, { commentId: comment.id }, context)).to.deep.equal({ success: true })
    expect(published[0][0]).to.equal(`peopleTyping:commentId:${comment.id}`)
  })

  const notificationFor = async (medium = 'InApp', reference = 'comment') => {
    const activity = await new Activity({ reader_id: member.id, actor_id: author.id, [reference + '_id']: reference === 'comment' ? comment.id : post.id, meta: { reasons: ['newComment'] } }).save()
    const notification = await new Notification({ user_id: member.id, activity_id: activity.id, medium: Notification.MEDIUM[medium] }).save()
    await notification.load(['activity', 'activity.reader', 'activity.actor', 'activity.post', 'activity.comment', 'activity.comment.post'])
    return notification
  }

  for (const name of ['updates', 'allUpdates']) {
    it(`filters queued notification events on ${name} after membership revocation`, async () => {
      const notification = await notificationFor()
      const payload = { notification: notification.toJSON() }
      async function * events () {
        yield payload
        await revoke()
        yield payload
      }
      async function * empty () {}
      const context = {
        currentUserId: member.id,
        request: { headers: new Headers() },
        pubSub: { subscribe: channel => channel.startsWith('updates:') ? events() : empty() }
      }
      const stream = await makeSubscriptions()[name].subscribe(null, {}, context)
      expect((await stream.next()).value).to.equal(payload)
      expect((await stream.next()).done).to.equal(true)
    })
  }

  it('rechecks comment digest recipients even when they still follow the post', async () => {
    await member.addSetting({ comment_notifications: 'email' }, true)
    await post.save({ updated_at: new Date() })
    const sent = []
    mockify(Email, 'sendCommentDigest', data => sent.push(data))
    const redis = RedisClient.create()
    try {
      await redis.del(Comment.sendDigests.REDIS_TIMESTAMP_KEY)
      await Comment.sendDigests()
      expect(sent.map(data => data.email)).to.deep.equal([member.get('email')])
      sent.length = 0
      await revoke()
      await redis.del(Comment.sendDigests.REDIS_TIMESTAMP_KEY)
      await Comment.sendDigests()
      expect(sent).to.have.length(0)
    } finally {
      unspyify(Email, 'sendCommentDigest')
      await redis.del(Comment.sendDigests.REDIS_TIMESTAMP_KEY)
    }
  })

  it('omits inactive comments from digests and reports zero sends as a number', async () => {
    await member.addSetting({ comment_notifications: 'email' }, true)
    await comment.save({ active: false })
    const sent = []
    mockify(Email, 'sendCommentDigest', data => sent.push(data))
    const redis = RedisClient.create()
    try {
      await redis.del(Comment.sendDigests.REDIS_TIMESTAMP_KEY)
      expect(await Comment.sendDigests()).to.equal(0)
      expect(sent).to.have.length(0)
    } finally {
      unspyify(Email, 'sendCommentDigest')
      await redis.del(Comment.sendDigests.REDIS_TIMESTAMP_KEY)
    }
  })

  for (const medium of ['Email', 'Push', 'InApp']) {
    it(`withholds a queued ${medium} notification when membership is revoked before sending`, async () => {
      const notification = await notificationFor(medium)
      const sent = []
      notification.sendEmail = async () => sent.push('email')
      notification.sendPush = async () => sent.push('push')
      notification.updateUserSocketRoom = async () => sent.push('in-app')
      await revoke()
      await notification.send()
      expect(sent).to.have.length(0)
      expect(await Notification.find(notification.id)).to.equal(null)
    })
  }

  it('delivers a queued notification to a current member', async () => {
    const notification = await notificationFor()
    const sent = []
    notification.updateUserSocketRoom = async () => sent.push('in-app')
    await notification.send()
    expect(sent).to.deep.equal(['in-app'])
    expect((await Notification.find(notification.id)).get('sent_at')).to.be.instanceOf(Date)
  })

  it('allows public discussion notifications after group membership ends', async () => {
    const notification = await notificationFor('InApp', 'post')
    await revoke()
    await post.save({ is_public: true })
    const sent = []
    notification.updateUserSocketRoom = async () => sent.push('in-app')
    await notification.send()
    expect(sent).to.deep.equal(['in-app'])
  })

  it('withholds deleted comment sources and rejects another notification reader', async () => {
    const notification = await notificationFor()
    expect(await notification.hasCurrentDiscussionAccess(outsider.id)).to.equal(false)
    await comment.save({ active: false })
    expect(await notification.hasCurrentDiscussionAccess(member.id)).to.equal(false)
  })

  it('rechecks access when a preloaded in-app notification is delivered directly', async () => {
    const notification = await notificationFor()
    memberships.set(Websockets.userRoom(member.id), new Set([member.id]))
    await revoke()
    await notification.updateUserSocketRoom(member.id)
    expect(received.get(member.id) || []).to.have.length(0)
  })
})
