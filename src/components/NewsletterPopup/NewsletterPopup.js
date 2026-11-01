import React, { useEffect, useRef, useState } from 'react';

import { FormattedMessage } from '../../util/reactIntl';
import NewsletterForm from '../NewsletterForm/NewsletterForm';

import popupImage from './newsletter-popup.jpg';
import css from './NewsletterPopup.module.css';

const STORAGE_KEY = 'newsletterPopup';
const SHOW_DELAY_MS = 6000;
const SNOOZE_DAYS = 30;

const readState = () => {
  try {
    const { until } = JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    return until || 0;
  } catch (e) {
    return 0;
  }
};

const snooze = days => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ until: Date.now() + days * 24 * 60 * 60 * 1000 })
    );
  } catch (e) {
    // storage unavailable (private mode etc.): popup may show again, which is fine
  }
};

/**
 * Newsletter signup popup. Shown once after a short delay; closing it hides it for
 * SNOOZE_DAYS, subscribing hides it for a year.
 */
const NewsletterPopup = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (readState() > Date.now()) {
      return;
    }
    const timer = window.setTimeout(() => {
      previouslyFocused.current = document.activeElement;
      setIsOpen(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    snooze(SNOOZE_DAYS);
    setIsOpen(false);
    previouslyFocused.current?.focus?.();
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const focusable = () =>
      dialogRef.current?.querySelectorAll('button, input:not([tabindex="-1"])') || [];
    focusable()[0]?.focus();

    const onKeyDown = e => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'Tab') {
        // keep focus inside the dialog
        const items = Array.from(focusable());
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={css.backdrop} onMouseDown={e => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-popup-title"
      >
        <button type="button" className={css.close} onClick={close}>
          <span aria-hidden="true">×</span>
          <span className={css.srOnly}>
            <FormattedMessage id="NewsletterPopup.close" />
          </span>
        </button>
        <div className={css.imageWrapper}>
          <img src={popupImage} alt="" className={css.image} />
        </div>
        <div className={css.content}>
          <p className={css.eyebrow}>
            <FormattedMessage id="NewsletterPopup.eyebrow" />
          </p>
          <h2 id="newsletter-popup-title" className={css.title}>
            <FormattedMessage id="NewsletterPopup.title" />
          </h2>
          <p className={css.text}>
            <FormattedMessage id="NewsletterPopup.text" />
          </p>
          <NewsletterForm
            id="newsletter-popup"
            source="website-popup"
            stacked
            onSubscribed={() => snooze(365)}
          />
          <p className={css.fineprint}>
            <FormattedMessage id="NewsletterPopup.fineprint" />
          </p>
        </div>
      </div>
    </div>
  );
};

export default NewsletterPopup;
