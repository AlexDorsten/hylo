import { GraphQLError } from 'graphql'
import { subscriptionPostId } from '../subscriptionAccess'

export default async function peopleTyping (parent, { messageThreadId, postId, commentId }, context, info) {
  const targetId = await subscriptionPostId({ messageThreadId, postId, commentId })
  if (!await Post.isVisibleToUser(targetId, context.currentUserId)) {
    throw new GraphQLError('TYPING_ACCESS_DENIED', { extensions: { code: 'TYPING_ACCESS_DENIED' } })
  }

  context.pubSub.publish(messageThreadId
    ? `peopleTyping:messageThreadId:${messageThreadId}`
    : postId
      ? `peopleTyping:postId:${postId}`
      : `peopleTyping:commentId:${commentId}`
  , { user: { id: context.currentUserId } })

  // Bridge to sockets, if it is inefficient we can call this peopleTyping mutation in Web
  // even before Web is setup to handle the subscription, and the userIsTyping socket event
  // will still push through the socket (see PostController#typing).
  const currentUser = await User.find(context.currentUserId)
  const post = await Post.find(targetId)
  await post.pushTypingToSockets(currentUser.id, currentUser.get('name'), true, context.socket)

  return { success: true }
}
