import { cyan } from 'chalk'
import sentry from '../../lib/sentry'
import emitter from 'socket.io-emitter'

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

  const postId = typeof room === 'string' && /^posts\/(\d+)$/.exec(room)?.[1]
  if (postId) {
    // Resolve the post afresh: the caller or an existing socket may predate a
    // membership, visibility or deletion change.
    const post = await Post.find(postId)
    if (!post) return
    if (post.get('type') === Post.Type.DISCUSSION && !post.isPublic()) {
      const members = await bookshelf.knex('group_memberships as memberships')
        .join('groups', 'groups.id', 'memberships.group_id')
        .join('groups_posts', 'groups_posts.group_id', 'groups.id')
        .join('users', 'users.id', 'memberships.user_id')
        .where({ 'groups_posts.post_id': postId, 'groups.active': true, 'memberships.active': true, 'users.active': true })
        .distinct('memberships.user_id')
      room = members.map(member => postUserRoom(postId, member.user_id))
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
  if (type === 'post' && req.session?.userId) {
    // Join both routes so a public-to-private change needs no client reconnect.
    // Only public/non-discussion events use the shared room; private discussion
    // events target the personal rooms of currently authorized members.
    return sails.sockets[method](req, postUserRoom(id, req.session.userId), err => {
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

const roomTypes = {
  user: userRoom,
  post: postRoom,
  group: groupRoom
}

const emptyResponse = res => err => err ? res.serverError(err) : res.ok({})
