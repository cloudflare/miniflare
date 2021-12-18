import PropTypes from "prop-types";
import React from "react";
import IconBase from "../../../components/icons/base";

// https://feathericons.com/ terminal
const IconCLI = ({ className, description }) => (
  <IconBase
    className={className}
    description={description}
    title="CLI icon"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
  >
    <polyline points="4 17 10 11 4 5"></polyline>
    <line x1="12" y1="19" x2="20" y2="19"></line>
  </IconBase>
);

IconCLI.defaultProps = {
  description: "Using the CLI",
};

IconCLI.propTypes = {
  description: PropTypes.string.isRequired,
};

export default IconCLI;
