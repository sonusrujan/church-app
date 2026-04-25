import { useEffect } from "react";

interface PageMeta {
  title: string;
  description?: string;
  canonical?: string;
}

/**
 * Sets document title, meta description, and canonical URL for the current page.
 * Reverts to defaults on unmount.
 */
export function usePageMeta({ title, description, canonical }: PageMeta) {
  useEffect(() => {
    const prev = document.title;
    document.title = title.includes("Shalom") ? title : `${title} | Shalom`;

    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const prevDesc = metaDesc?.content ?? "";
    if (description && metaDesc) {
      metaDesc.content = description;
    }

    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const prevCanonical = link?.href ?? "";
    if (canonical && link) {
      link.href = canonical;
    }

    // Update OG tags
    const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    const prevOgTitle = ogTitle?.content ?? "";
    if (ogTitle) ogTitle.content = title.includes("Shalom") ? title : `${title} | Shalom`;

    const ogDesc = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
    const prevOgDesc = ogDesc?.content ?? "";
    if (description && ogDesc) ogDesc.content = description;

    const ogUrl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null;
    const prevOgUrl = ogUrl?.content ?? "";
    if (canonical && ogUrl) ogUrl.content = canonical;

    return () => {
      document.title = prev;
      if (metaDesc) metaDesc.content = prevDesc;
      if (link) link.href = prevCanonical;
      if (ogTitle) ogTitle.content = prevOgTitle;
      if (ogDesc) ogDesc.content = prevOgDesc;
      if (ogUrl) ogUrl.content = prevOgUrl;
    };
  }, [title, description, canonical]);
}
