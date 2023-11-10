import "./config-tabs.css";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Helmet from "react-helmet";

import getUniqueReadableID from "../../../utils/get-unique-readable-id";
import IconAPI from "../icons/api";
import IconWrangler from "../icons/wrangler";

// Page/storage synchronisation adapted from components/theme-toggle.js

const TABS = [
  { id: "wrangler", name: "wrangler.toml", Icon: IconWrangler, mono: true },
  { id: "api", name: "JavaScript API", Icon: IconAPI },
];

// Run tab initialisation in the <head/> to avoid a flash
const getTabFromStorageSource = `(function() {
let tab;
try {
  tab = localStorage.getItem("tab");
} catch (e) {}
document.documentElement.setAttribute("data-tab", tab || "api");
})();`;

function getTabFromStorage() {
  let tab;
  try {
    tab = localStorage.getItem("tab");
  } catch (e) {}
  return tab || "api";
}

function setTab($tabs, tab) {
  // 1. Get the current y-position of the tabs container that caused this
  // change. We want to keep its position in the viewport fixed.
  const initialOffset = $tabs.offsetTop;

  // 2. Actually update the tab
  // Update root "data-tab" attribute to change which tab is styled as active
  // and visible
  document.documentElement.setAttribute("data-tab", tab);
  // Dispatch custom "tab" event to update tab in all instances of this
  // component (currently, this is only used to update the "aria-selected"
  // attribute on tabs)
  try {
    document.dispatchEvent(new CustomEvent("tab", { detail: tab }));
  } catch (e) {}
  // Store the newly selected tab so it persists between reloads
  try {
    localStorage.setItem("tab", tab);
  } catch (e) {}

  // 3. Get the new y-position of the tabs and update the scroll position with
  // the difference, so the tabs stay in the same position in the viewport.
  requestAnimationFrame(() => {
    const newOffset = $tabs.offsetTop;
    window.scrollBy({ top: newOffset - initialOffset, behavior: "instant" });
  });
}

function useTab() {
  // Start with getting the tab from localStorage
  const [tab, setTab] = useState(getTabFromStorage());
  // ...then watch for updates from any other instance of this component
  useEffect(() => {
    const listener = (event) => setTab(event.detail);
    document.addEventListener("tab", listener);
    return () => document.removeEventListener("tab", listener);
  }, [setTab]);
  return tab;
}

export default ({ children }) => {
  // TODO: keyboard navigation, see https://inclusive-components.design/tabbed-interfaces/
  // Get an ID for this instance for accessibility labelling (doesn't matter if
  // this changes, so useMemo is fine)
  const tabsID = useMemo(() => getUniqueReadableID("tabs"), []);
  // Watch the selected tab
  const tab = useTab();
  const ref = useRef(null);

  return (
    <>
      <Helmet>
        {/* Run tab initialisation in the <head/> to avoid a flash */}
        <script>{getTabFromStorageSource}</script>
        {/* If JavaScript is disabled, fallback to all examples without tabs */}
        <noscript>{"<style>.ConfigTabs{display:none;}</style>"}</noscript>
      </Helmet>

      <noscript className="ConfigTabs--noscript">{children}</noscript>

      <pre
        ref={ref}
        className="ConfigTabs CodeBlock CodeBlock-with-rows CodeBlock-scrolls-horizontally CodeBlock-is-light-in-light-theme"
      >
        <ul className="ConfigTabs--tabs" role="tablist">
          {/* Include selectable tab headers */}
          {TABS.map(({ id, name, Icon, mono }) => (
            <li
              key={id}
              data-tab-id={id}
              className={
                // Only use a sans-serif font if not mono(spaced)
                "ConfigTabs--tab" + (mono ? "" : " ConfigTabs--tab-sans-serif")
              }
              role="presentation"
            >
              <a
                role="tab"
                id={`${tabsID}-${id}`}
                href={`#${tabsID}-${id}`}
                aria-selected={tab === id}
                onClick={(event) => {
                  event.preventDefault();
                  setTab(ref.current, id);
                }}
              >
                <Icon />
                <span className="ConfigTabs--tab--label">{name}</span>
              </a>
            </li>
          ))}
        </ul>

        {/* Include actual tab contents */}
        {TABS.map(({ id }, i) => (
          <section
            key={id}
            data-tab-id={id}
            className="ConfigTabs--panel"
            role="tabpanel"
            aria-labelledby={`${tabsID}-${id}`}
          >
            {children[i]}
          </section>
        ))}
      </pre>
    </>
  );
};
