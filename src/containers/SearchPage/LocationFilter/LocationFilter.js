import React, { useEffect, useState } from 'react';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { fetchLocationFilterOptions } from '../../../util/api';

import SelectSingleFilter from '../SelectSingleFilter/SelectSingleFilter';

const { LatLng, LatLngBounds } = sdkTypes;

const toBounds = ({ ne, sw }) =>
  new LatLngBounds(new LatLng(ne[0], ne[1]), new LatLng(sw[0], sw[1]));

// Shared between the desktop sidebar and the mobile filter modal, so it's fetched once per page load.
let optionsPromise = null;
const loadOptions = () => {
  if (!optionsPromise) {
    // Wrapped so a synchronous error (e.g. no window.fetch) becomes a rejection, not a crash.
    optionsPromise = Promise.resolve()
      .then(() => fetchLocationFilterOptions())
      .then(json => json?.options || [])
      .catch(e => {
        optionsPromise = null; // allow a retry on the next mount
        throw e;
      });
  }
  return optionsPromise;
};

/**
 * Sidebar location filter: a radio-style list (same UI as the other single-select filters)
 * of the places where published listings are, most common first. The list comes from
 * GET /api/location-filter-options, which groups listings by their saved state.
 * Picking a place sets the `address` & `bounds` query params, so listings are matched by
 * their geolocation.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.initialValues - { address }
 * @param {Function} props.onSubmit - called with { address, bounds }
 */
const LocationFilter = props => {
  const {
    initialValues,
    onSubmit,
    queryParamNames, // replaced below
    ...rest
  } = props;
  const [options, setOptions] = useState([]);

  useEffect(() => {
    let isMounted = true;
    loadOptions()
      .then(loaded => isMounted && setOptions(loaded))
      .catch(() => isMounted && setOptions([]));
    return () => {
      isMounted = false;
    };
  }, []);

  if (options.length === 0) {
    // Nothing to choose from (still loading, failed, or no listings have a location yet)
    return null;
  }

  const name = 'location';
  const selected = options.find(o => o.label === initialValues?.address);
  const selectInitialValues = selected ? { [name]: selected.option } : {};

  const handleSubmit = values => {
    const option = options.find(o => o.option === values?.[name]);
    onSubmit(
      option
        ? { address: option.label, bounds: toBounds(option.bounds) }
        : { address: null, bounds: null }
    );
  };

  return (
    <SelectSingleFilter
      {...rest}
      name={name}
      queryParamNames={[name]}
      initialValues={selectInitialValues}
      options={options.map(({ option, label, count }) => ({
        option,
        label: `${label} (${count})`,
      }))}
      isNestedEnum={false}
      onSubmit={handleSubmit}
    />
  );
};

export default LocationFilter;
