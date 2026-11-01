import React from 'react';
import { useConfiguration } from '../../context/configurationContext';
import loadable from '@loadable/component';

import { FormattedMessage } from '../../util/reactIntl';
import NewsletterForm from '../../components/NewsletterForm/NewsletterForm';

import css from './FooterContainer.module.css';

const SectionBuilder = loadable(
  () => import(/* webpackChunkName: "SectionBuilder" */ '../PageBuilder/PageBuilder'),
  {
    resolveComponent: components => components.SectionBuilder,
  }
);

const FooterComponent = () => {
  const { footer = {}, topbar } = useConfiguration();

  // If footer asset is not set, let's not render Footer at all.
  if (Object.keys(footer).length === 0) {
    return null;
  }

  // The footer asset does not specify sectionId or sectionType. However, the SectionBuilder
  // expects sectionId and sectionType in order to identify the section. We add those
  // attributes here before passing the asset to SectionBuilder.
  const footerSection = {
    ...footer,
    sectionId: 'footer',
    sectionType: 'footer',
    linkLogoToExternalSite: topbar?.logoLink,
  };

  return (
    <>
      <section className={css.newsletter} aria-labelledby="footer-newsletter-title">
        <h2 id="footer-newsletter-title" className={css.title}>
          <FormattedMessage id="NewsletterForm.footerTitle" />
        </h2>
        <NewsletterForm id="footer-newsletter" source="website-footer" className={css.form} />
      </section>
      <SectionBuilder sections={[footerSection]} />
    </>
  );
};

// NOTE: if you want to add dynamic data to FooterComponent,
//       you could just connect this FooterContainer to Redux Store
//
// const mapStateToProps = state => {
//   const { currentUser } = state.user;
//   return { currentUser };
// };
// const FooterContainer = compose(connect(mapStateToProps))(FooterComponent);
// export default FooterContainer;

export default FooterComponent;
