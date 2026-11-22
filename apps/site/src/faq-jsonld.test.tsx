import { describe, expect, it } from "vitest";
import { faqs } from "./App";
import { faqJsonLdScript } from "./faq-jsonld";

describe("FAQPage JSON-LD", () => {
  const script = faqJsonLdScript(faqs);
  const match = script.match(/^<script type="application\/ld\+json">(.*)<\/script>$/s);

  it("is one script tag holding valid JSON", () => {
    expect(match).not.toBeNull();
    expect(() => JSON.parse(match![1])).not.toThrow();
  });

  it("has one Question per visible FAQ entry with the visible answer text", () => {
    const data = JSON.parse(match![1]);
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("FAQPage");
    expect(faqs.length).toBeGreaterThan(0);
    expect(data.mainEntity).toHaveLength(faqs.length);
    faqs.forEach((f, i) => {
      expect(data.mainEntity[i]["@type"]).toBe("Question");
      expect(data.mainEntity[i].name).toBe(f.q);
      expect(data.mainEntity[i].acceptedAnswer).toEqual({ "@type": "Answer", text: f.a });
    });
  });
});
