import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { subscribeToNewsletter } from '../../util/api';

import css from './NewsletterForm.module.css';

const IDLE = 'idle';
const SENDING = 'sending';
const DONE = 'done';
const ALREADY = 'already';

/**
 * Email + Subscribe button that posts to /api/newsletter-subscribe (Mailchimp).
 *
 * @param {string} props.source 'website-footer' | 'website-popup', stored as a Mailchimp tag
 * @param {boolean?} props.stacked always put the button under the input
 * @param {Function?} props.onSubscribed called after a successful signup
 */
const NewsletterForm = props => {
  const { className, source, id, stacked, onSubscribed } = props;
  const intl = useIntl();
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [status, setStatus] = useState(IDLE);
  const [errorId, setErrorId] = useState(null);

  const handleSubmit = e => {
    e.preventDefault();
    if (status === SENDING) {
      return;
    }
    setErrorId(null);
    setStatus(SENDING);
    subscribeToNewsletter({ email, source, company })
      .then(data => {
        setStatus(data?.status === 'already-subscribed' ? ALREADY : DONE);
        onSubscribed?.();
      })
      .catch(err => {
        setStatus(IDLE);
        setErrorId(
          err?.error === 'invalid-email'
            ? 'NewsletterForm.invalidEmail'
            : err?.error === 'cannot-resubscribe'
            ? 'NewsletterForm.cannotResubscribe'
            : 'NewsletterForm.error'
        );
      });
  };

  if (status === DONE || status === ALREADY) {
    return (
      <p className={classNames(css.success, className)} role="status">
        <FormattedMessage
          id={status === ALREADY ? 'NewsletterForm.alreadySubscribed' : 'NewsletterForm.success'}
        />
      </p>
    );
  }

  return (
    <form className={classNames(css.root, className)} onSubmit={handleSubmit} noValidate>
      <div className={classNames(css.row, { [css.stacked]: stacked })}>
        <label htmlFor={`${id}-email`} className={css.srOnly}>
          <FormattedMessage id="NewsletterForm.emailLabel" />
        </label>
        <input
          id={`${id}-email`}
          className={css.input}
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={intl.formatMessage({ id: 'NewsletterForm.emailPlaceholder' })}
          required
        />
        {/* Honeypot: hidden from people and assistive tech, bots tend to fill it */}
        <input
          className={css.honeypot}
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={company}
          onChange={e => setCompany(e.target.value)}
        />
        <button type="submit" className={css.button} disabled={status === SENDING}>
          <FormattedMessage
            id={status === SENDING ? 'NewsletterForm.subscribing' : 'NewsletterForm.subscribe'}
          />
        </button>
      </div>
      {errorId ? (
        <p className={css.error} role="alert">
          <FormattedMessage id={errorId} />
        </p>
      ) : null}
    </form>
  );
};

export default NewsletterForm;
