import { v4 as uuidv4 } from 'uuid'
let instance

// An unconfigured community instance must neither initialize Segment nor emit
// tracking pixels. Keep the explicit opt-out for existing configured instances.
const segmentDisabled =
  !process.env.SEGMENT_KEY || process.env.NODE_ENV === 'test' || process.env.DISABLE_SEGMENT === '1'

if (segmentDisabled) {
  instance = {
    track: function () {}
  }
} else {
  instance = require('analytics-node')(process.env.SEGMENT_KEY)
}

instance.pixelUrl = function (emailName, props) {
  if (segmentDisabled) return undefined
  const prefix = 'https://api.segment.io/v1/pixel/track?data='

  const data = {
    writeKey: process.env.SEGMENT_KEY,
    event: 'Viewed Email: ' + emailName,
    properties: props
  }

  if (props.userId) {
    data.userId = props.userId
  } else {
    data.anonymousId = uuidv4()
  }

  const encodedData = Buffer.from(JSON.stringify(data), 'utf8').toString('base64')
  return prefix + encodedData
}

instance.trackSignup = function (userId, req) {
  const properties = { platform: 'Web' }
  if (req.headers['ios-version']) {
    properties.platform = 'ios'
  } else if (req.headers['android-version']) {
    properties.platform = 'android'
  }
  this.track({
    userId,
    event: 'Signup success',
    properties
  })
}

module.exports = instance
