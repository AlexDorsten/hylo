import { GraphQLError } from 'graphql'

const value = (model, field) => model?.get ? model.get(field) : model?.[field]

export async function subscriptionPostId ({ messageThreadId, postId, commentId }) {
  if (messageThreadId || postId) return messageThreadId || postId
  if (!/^\d+$/.test(String(commentId))) return null
  const comment = await Comment.find(commentId)
  return comment && value(comment, 'active') ? value(comment, 'post_id') : null
}

export async function requireSubscriptionAccess (context, postId) {
  if (!await Post.isVisibleToUser(postId, context.currentUserId)) {
    throw new GraphQLError('SUBSCRIPTION_ACCESS_DENIED', { extensions: { code: 'SUBSCRIPTION_ACCESS_DENIED' } })
  }
}

// Never cache this decision for the lifetime of an SSE connection: membership
// can be revoked while the browser is still listening to the same channel.
export const withPostAccess = ({ context, postId }) => async function * (events) {
  for await (const payload of events) {
    const targetId = value(payload.post, 'id') || value(payload.comment, 'post_id') || postId
    if (await Post.isVisibleToUser(targetId, context.currentUserId)) yield payload
  }
}

// Notification events can already be queued when membership changes. Resolve
// the persisted notification so an old event does not carry an old access grant.
export const withNotificationAccess = ({ context }) => async function * (events) {
  for await (const payload of events) {
    if (payload.notification) {
      if (!context.currentUserId) continue
      const notification = await Notification.find(value(payload.notification, 'id'))
      if (!notification || !await notification.hasCurrentDiscussionAccess(context.currentUserId)) continue
    }
    yield payload
  }
}
