import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDoi, findDoiInText } from "../src/lib/doi.ts";
import { crossrefToMeta, stripJats } from "../src/lib/crossref.ts";
import { toBibTeX, toBibTeXAll, toRIS, bibKey, parseAuthorList, citationLabel } from "../src/lib/citations.ts";

test("normalizeDoi handles URLs, prefixes, case and trailing punctuation", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1038/NATURE12373"), "10.1038/nature12373");
  assert.equal(normalizeDoi("doi: 10.1016/j.cell.2020.01.001."), "10.1016/j.cell.2020.01.001");
  assert.equal(normalizeDoi("https://doi.org/10.1093%2Fnar%2Fgkab1112"), "10.1093/nar/gkab1112");
  assert.equal(normalizeDoi("not a doi"), null);
  assert.equal(normalizeDoi(""), null);
});

test("findDoiInText finds DOIs in PDF text, even with a split after the slash", () => {
  assert.equal(findDoiInText("Nature 499, 2013. doi: 10.1038/ nature12373 Received"), "10.1038/nature12373");
  assert.equal(findDoiInText("(https://doi.org/10.1056/NEJMoa2034577)"), "10.1056/nejmoa2034577");
  assert.equal(findDoiInText("no identifier here"), null);
});

const work = {
  DOI: "10.1038/NATURE12373",
  title: ["Nanometre-scale thermometry in a living cell"],
  author: [{ family: "Kucsko", given: "G." }, { family: "Maurer", given: "P. C." }, { name: "Consortium X" }],
  "container-title": ["Nature"],
  volume: "500",
  issue: "7460",
  page: "54-58",
  publisher: "Springer Science and Business Media LLC",
  type: "journal-article",
  issued: { "date-parts": [[2013, 7, 31]] },
  abstract: "<jats:title>Abstract</jats:title><jats:p>Sensitive probing of temperature &amp; heat.</jats:p>",
};

test("crossrefToMeta maps fields", () => {
  const m = crossrefToMeta(work);
  assert.equal(m.title, "Nanometre-scale thermometry in a living cell");
  assert.deepEqual(m.authors[0], { family: "Kucsko", given: "G." });
  assert.deepEqual(m.authors[2], { family: "Consortium X" });
  assert.equal(m.year, 2013);
  assert.equal(m.journal, "Nature");
  assert.equal(m.doi, "10.1038/nature12373");
  assert.equal(m.item_type, "article");
  assert.equal(m.abstract, "Sensitive probing of temperature & heat.");
});

test("stripJats handles empty input", () => {
  assert.equal(stripJats(undefined), null);
});

test("BibTeX export", () => {
  const m = crossrefToMeta(work);
  const bib = toBibTeX({ ...m, tags: ["thermometry"] });
  assert.match(bib, /^@article\{kucsko2013nanometre,/);
  assert.match(bib, /author = \{Kucsko, G\. and Maurer, P\. C\. and \{Consortium X\}\}/);
  assert.match(bib, /pages = \{54--58\}/);
  assert.match(bib, /keywords = \{thermometry\}/);
  assert.match(bib, /title = \{\{Nanometre-scale thermometry in a living cell\}\}/);
  // special characters escaped
  assert.match(toBibTeX({ ...m, title: "A & B 50% of C_d" }), /A \\& B 50\\% of C\\_d/);
});

test("BibTeX keys are unique across a batch", () => {
  const m = crossrefToMeta(work);
  const all = toBibTeXAll([m, m, m]);
  assert.ok(all.includes("{kucsko2013nanometre,") && all.includes("{kucsko2013nanometrea,") && all.includes("{kucsko2013nanometreb,"));
  assert.equal(bibKey({ ...m, authors: [{ family: "Müller" }] }), "muller2013nanometre");
});

test("RIS export", () => {
  const ris = toRIS(crossrefToMeta(work));
  const lines = ris.split("\r\n");
  assert.equal(lines[0], "TY  - JOUR");
  assert.ok(lines.includes("AU  - Kucsko, G."));
  assert.ok(lines.includes("SP  - 54") && lines.includes("EP  - 58"));
  assert.ok(lines.includes("DO  - 10.1038/nature12373"));
  assert.equal(lines[lines.length - 1], "ER  - ");
});

test("parseAuthorList understands common formats", () => {
  assert.deepEqual(parseAuthorList("Smith J, Doe A"), [{ family: "Smith", given: "J" }, { family: "Doe", given: "A" }]);
  assert.deepEqual(parseAuthorList("Jane Smith; John Q Doe"), [{ family: "Smith", given: "Jane" }, { family: "Doe", given: "John Q" }]);
  assert.deepEqual(parseAuthorList("Smith, Jane and Doe, John"), [{ family: "Smith", given: "Jane" }, { family: "Doe", given: "John" }]);
  assert.equal(citationLabel({ authors: parseAuthorList("Smith J, Doe A, Roe B"), year: 2024 }), "Smith et al. 2024");
});
