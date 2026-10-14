// Last stop for errors: known errors carry a statusCode, the rest are 500s.
exports.errorHandler = (err, req, res, _next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ status: 'error', message: Object.values(err.errors).map((e) => e.message).join('. ') });
  }
  if (err.name === 'CastError') return res.status(400).json({ status: 'error', message: 'Invalid id' });
  if (err.code === 11000) return res.status(409).json({ status: 'error', message: 'That already exists' });
  const status = err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ status: 'error', message: status >= 500 ? 'Something went wrong on the server' : err.message });
};
