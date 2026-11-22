// Builds the FAQPage structured data from the same entries that render the visible FAQ.
export interface FaqEntry {
  q: string;
  a: string;
}

export function faqJsonLd(entries: readonly FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.q,
      acceptedAnswer: { "@type": "Answer", text: e.a },
    })),
  };
}

// Serialized for an inline <script type="application/ld+json">; "<" is escaped so the text cannot close the tag.
export function faqJsonLdScript(entries: readonly FaqEntry[]): string {
  const json = JSON.stringify(faqJsonLd(entries)).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
