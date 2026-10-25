// src/containers/AboutPage/AboutPage.js
import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { useConfiguration } from '../../context/configurationContext';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { Page, LayoutSingleColumn, NamedLink } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import heroImage from './ebi-closet-hero.jpg';
import portraitImage from './ebi-closet-portrait.jpg';
import duoImage from './ebi-closet-duo.jpg';
import css from './AboutPage.module.css';

const AboutPageComponent = ({ scrollingDisabled }) => {
  const intl = useIntl();
  const config = useConfiguration();
  const title = intl.formatMessage(
    { id: 'AboutPage.title' },
    { marketplaceName: config.marketplaceName }
  );

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="AboutPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <header className={css.intro}>
            <h1 className={css.tagline}>
              <FormattedMessage id="AboutPage.tagline" />
            </h1>
            <p className={css.subtitle}>
              <FormattedMessage id="AboutPage.subtitle" />
            </p>
          </header>

          <img
            src={heroImage}
            alt={intl.formatMessage({ id: 'AboutPage.heroAlt' })}
            className={css.heroImage}
          />

          <div className={css.content}>
            <p className={css.body}>
              <FormattedMessage id="AboutPage.welcome" />
            </p>

            <h2 className={css.sectionHeading}>
              <FormattedMessage id="AboutPage.whatWeDoHeading" />
            </h2>
            <p className={css.tight}>
              <FormattedMessage id="AboutPage.whatWeDo1" />
            </p>
            <p className={css.tight}>
              <FormattedMessage id="AboutPage.whatWeDo2" />
            </p>
            <p className={css.tight}>
              <FormattedMessage id="AboutPage.whatWeDo3" />
            </p>
            <p className={css.categories}>
              <FormattedMessage id="AboutPage.categories" />
            </p>
            <p className={css.body}>
              <FormattedMessage id="AboutPage.whatWeDo4" />
            </p>

            <div className={css.ctaWrapper}>
              <NamedLink name="SearchPage" className={css.cta}>
                <FormattedMessage id="AboutPage.shopCta" />
              </NamedLink>
            </div>

            <h2 className={css.sectionHeading}>
              <FormattedMessage id="AboutPage.whyWeDoItHeading" />
            </h2>
            <div className={css.whySplit}>
              <img
                src={portraitImage}
                alt={intl.formatMessage({ id: 'AboutPage.portraitAlt' })}
                className={css.portraitImage}
              />
              <div className={css.whyText}>
                <p className={css.body}>
                  <FormattedMessage id="AboutPage.whyWeDoIt1" />
                </p>
                <p className={css.body}>
                  <FormattedMessage id="AboutPage.whyWeDoIt2" />
                </p>
                <p className={css.body}>
                  <FormattedMessage id="AboutPage.whyWeDoIt3" />
                </p>
                <p className={css.body}>
                  <FormattedMessage id="AboutPage.whyWeDoIt4" />
                </p>
              </div>
            </div>
          </div>

          <section className={css.closing}>
            <h2 className={css.closingHeading}>
              <FormattedMessage id="AboutPage.moreThanHeading" />
            </h2>
            <p className={css.closingText}>
              <FormattedMessage id="AboutPage.moreThan1" />
            </p>
            <img
              src={duoImage}
              alt={intl.formatMessage({ id: 'AboutPage.duoAlt' })}
              className={css.duoImage}
            />
            <p className={css.closingText}>
              <FormattedMessage id="AboutPage.moreThan2" />
            </p>
            <p className={css.closingText}>
              <FormattedMessage id="AboutPage.moreThan3" />
            </p>
            <p className={css.closingText}>
              <FormattedMessage id="AboutPage.moreThan4" />
            </p>
            <p className={css.closingBrand}>
              <FormattedMessage id="AboutPage.brand" />
            </p>
            <p className={css.closingBrand}>
              <FormattedMessage id="AboutPage.slogan" />
            </p>
            {/* /l/new requires login: signed-out visitors are sent to sign up / log in
                and brought back to create their listing afterwards. */}
            <div className={css.ctaWrapper}>
              <NamedLink name="NewListingPage" className={css.cta}>
                <FormattedMessage id="AboutPage.sellCta" />
              </NamedLink>
            </div>
          </section>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => ({
  scrollingDisabled: isScrollingDisabled(state),
});

const AboutPage = compose(connect(mapStateToProps))(AboutPageComponent);

export default AboutPage;
