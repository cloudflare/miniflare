import PropTypes from "prop-types";
import React from "react";
import IconBase from "../../../components/icons/base";

// https://feathericons.com/ file-text
const IconWrangler = ({ className, description }) => (
  <IconBase
    className={className}
    description={description}
    title="wrangler.toml icon"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </IconBase>
);

IconWrangler.defaultProps = {
  description: "Using wrangler.toml",
};

IconWrangler.propTypes = {
  description: PropTypes.string.isRequired,
};

export default IconWrangler;
