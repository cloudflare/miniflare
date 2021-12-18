import PropTypes from "prop-types";
import React from "react";
import IconBase from "../../../components/icons/base";

// https://feathericons.com/ sliders
const IconAPI = ({ className, description }) => (
  <IconBase
    className={className}
    description={description}
    title="API icon"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
  >
    <line x1="4" y1="21" x2="4" y2="14"></line>
    <line x1="4" y1="10" x2="4" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12" y2="3"></line>
    <line x1="20" y1="21" x2="20" y2="16"></line>
    <line x1="20" y1="12" x2="20" y2="3"></line>
    <line x1="1" y1="14" x2="7" y2="14"></line>
    <line x1="9" y1="8" x2="15" y2="8"></line>
    <line x1="17" y1="16" x2="23" y2="16"></line>
  </IconBase>
);

IconAPI.defaultProps = {
  description: "Using the API",
};

IconAPI.propTypes = {
  description: PropTypes.string.isRequired,
};

export default IconAPI;
