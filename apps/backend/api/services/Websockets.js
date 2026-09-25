import { cyan } from 'chalk'
import sentry from '../../lib/sentry'
import emitter from 'socket.io-emitter'
import { readableDiscussionIds } from '../../lib/discussionAccess'

const validMessageTypes = [
  'commentAdded',
  'groupUpdated',
  'messageAdded',
  'messageUpdated',
  'userTyping',
  'newThread',
  'newNotification',
  'newPost',
  'openJoinRequestCountUpdated',
  // Room presence (see RoomPresence service)
  'memberPresent',
  'memberAway'
]

let io
let cleanupRegistered = false

function registerCleanup () {
  if (cleanupRegistered || process.env.NODE_ENV === 'test') {
    return
  }

  cleanupRegistered = true

  const cleanup = () => {
    if (io && io.redis) {
      // Close Redis connection
      if (typeof io.redis.quit === 'function') {
        // socket.io-emitter uses node-redis's callback API, not a Promise.
        io.redis.quit(err => {
          if (err && sails && sails.log) {
            sails.log.error('Error closing socket.io-emitter Redis connection:', err)
          }
        })
      } else if (typeof io.redis.disconnect === 'function') {
        io.redis.disconnect()
      }
      io = null
    }
  }

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  process.on('exit', cleanup)
}

export function broadcast (room, messageType, payload, socketToExclude) {
  if (sails.sockets) {
    sails.sockets.broadcast(room, messageType, payload, socketToExclude)
  } else {
    if (!io) {
      io = emitter(process.env.REDIS_URL)
      io.redis.on('error', err => {
        sentry.error(err, null, { room, messageType, payload })
      })
      registerCleanup()
    }
    // The worker emitter accepts one room per .in() call, unlike Sails.
    for (const name of [].concat(room)) io.in(name)
    io.emit(messageType, payload) // TODO handle socketToExclude
  }
}

export async function pushToSockets (room, messageType, payload, socketToExclude) {
  if (!validMessageTypes.includes(messageType)) {
    throw new Error(`unknown message type: ${messageType}`)
  }

  const groupId = typeof room === 'string' && /^groups\/(\d+)$/.exec(room)?.[1]
  const postId = (typeof room === 'string' && /^posts\/(\d+)$/.exec(room)?.[1]) ||
    (groupId && messageType === 'newPost' && payload.id)
  if (postId) {
    // Resolve the post afresh: the caller or an existing socket may predate a
    // membership, visibility or deletion change.
    const post = await Post.find(postId)
    if (!post) return
    if (post.get('type') === Post.Type.DISCUSSION && !post.isPublic()) {
      const db = bookshelf.knex
      const members = await db('users as recipient').select('recipient.id')
        .where('recipient.active', true)
        .whereExists(readableDiscussionIds(db.ref('recipient.id')).where('discussion_post.id', postId))
      room = members.map(member => groupId ? groupUserRoom(groupId, member.id) : postUserRoom(postId, member.id))
      if (!room.length) return
    }
  }

  sails.log.info(`${cyan('Websockets:')} pushToSockets: ${room}, ${messageType}`)
  if (process.env.NODE_ENV === 'test') return { room, messageType, payload }
  broadcast(room, messageType, payload, socketToExclude)
}

const makeRoomAction = method => (req, res, type, id, options = {}) => {
  const callback = options.callback || emptyResponse(res)
  const room = roomTypes[type](id)
  sails.log.info(`${cyan('Websockets:')} ${method}: ${room}`)
  if (['post', 'group'].includes(type) && req.session?.userId) {
    // Join both routes so a public-to-private change needs no client reconnect.
    // Only public/non-discussion events use the shared room; private discussion
    // events target the personal rooms of currently authorized members.
    const personalRoom = type === 'post' ? postUserRoom(id, req.session.userId) : groupUserRoom(id, req.session.userId)
    return sails.sockets[method](req, personalRoom, err => {
      if (err) return callback(err)
      sails.sockets[method](req, room, callback)
    })
  }
  return sails.sockets[method](req, room, callback)
}

export const joinRoom = makeRoomAction('join')
export const leaveRoom = makeRoomAction('leave')

export function userRoom (userId) {
  return `users/${userId}`
}

export function postRoom (postId) {
  return `posts/${postId}`
}

export function postUserRoom (postId, userId) {
  return `posts/${postId}/users/${userId}`
}

export function groupRoom (groupId) {
  return `groups/${groupId}`
}

export function groupUserRoom (groupId, userId) {
  return `groups/${groupId}/users/${userId}`
}

const roomTypes = {
  user: userRoom,
  post: postRoom,
  group: groupRoom
}

const emptyResponse = res => err => err ? res.serverError(err) : res.ok({})
