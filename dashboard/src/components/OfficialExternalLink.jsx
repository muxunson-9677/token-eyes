import React from "react";
import providerLinksRegistry from "../../../shared/provider-links.json";
import { openExternalLink } from "../lib/api";
import { isTauriRuntime } from "../lib/local-api-url";

const PROVIDER_LINKS_BY_ID = new Map(
  providerLinksRegistry.links.map((link) => [link.link_id, link]),
);

export function resolveProviderLink(linkId) {
  return PROVIDER_LINKS_BY_ID.get(String(linkId || "")) || null;
}

export function resolveProviderLinkUrl(linkId) {
  return resolveProviderLink(linkId)?.url || "";
}

export function OfficialExternalLink({ linkId, children, onClick, ...props }) {
  const link = resolveProviderLink(linkId);
  if (!link) return null;

  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !isTauriRuntime()) return;
    event.preventDefault();
    void openExternalLink(link.link_id).catch(() => {});
  };

  return (
    <a
      {...props}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      data-provider-link-id={link.link_id}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
