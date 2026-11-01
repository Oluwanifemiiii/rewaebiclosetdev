// POST /api/newsletter-subscribe  { email, source?, company? }
//
// Adds the email to the Mailchimp audience as "pending" (double opt-in: Mailchimp sends the
// confirmation email). The API key stays on the server.
//
// Uses PUT /lists/{id}/members/{md5(email)} so repeated signups are idempotent, and
// status_if_new leaves existing members (subscribed, unsubscribed, ...) untouched.

const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SOURCES = ['website-footer', 'website-popup'];

module.exports = async (req, res) => {
  const { email, source, company } = req.body || {};

  // Honeypot: real users never fill this hidden field. Pretend success to bots.
  if (company) {
    return res.status(200).json({ status: 'ok' });
  }

  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanEmail || cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: 'invalid-email' });
  }

  const { MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX, MAILCHIMP_AUDIENCE_ID } = process.env;
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_SERVER_PREFIX || !MAILCHIMP_AUDIENCE_ID) {
    console.error('Newsletter signup: Mailchimp env vars are not configured');
    return res.status(500).json({ error: 'not-configured' });
  }

  const hash = crypto
    .createHash('md5')
    .update(cleanEmail)
    .digest('hex');
  const url = `https://${MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`;
  const tag = ALLOWED_SOURCES.includes(source) ? source : 'website';

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`anystring:${MAILCHIMP_API_KEY}`).toString('base64')}`,
      },
      body: JSON.stringify({
        email_address: cleanEmail,
        status_if_new: 'pending',
        tags: [tag],
      }),
    });

    if (response.ok) {
      // The PUT returns the member as it is now: existing members keep their status
      // (status_if_new only applies to new ones), so we can tell the visitor what happened.
      const member = await response.json().catch(() => ({}));
      if (member.status === 'subscribed') {
        return res.status(200).json({ status: 'already-subscribed' });
      }
      if (member.status === 'unsubscribed' || member.status === 'cleaned') {
        // Mailchimp doesn't allow re-adding these via the API; they must re-subscribe themselves.
        return res.status(400).json({ error: 'cannot-resubscribe' });
      }
      return res.status(200).json({ status: 'ok' });
    }

    const body = await response.json().catch(() => ({}));
    if (body.title === 'Invalid Resource' || body.title === 'Forgotten Email Not Subscribed') {
      // e.g. Mailchimp rejects fake/blocked domains, or a previously deleted contact.
      return res.status(400).json({ error: 'invalid-email' });
    }
    console.error('Newsletter signup: Mailchimp error', response.status, body.title, body.detail);
    return res.status(502).json({ error: 'subscribe-failed' });
  } catch (e) {
    console.error('Newsletter signup: request failed', e.message);
    return res.status(502).json({ error: 'subscribe-failed' });
  }
};
