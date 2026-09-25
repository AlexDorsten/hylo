// Administrative access uses the ordinary login and explicit HYLO_ADMINS.
module.exports = {
  create: (req, res) => res.redirect('/login'),
  oauth: (req, res) => res.notFound(),
  destroy: (req, res) => {
    req.session.destroy(error => error ? res.serverError() : res.redirect('/'))
  }
}
