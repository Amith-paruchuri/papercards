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

import { cleanPdfText } from "../src/lib/clean-text.ts";
import { parseReply, validateRequest, buildPrompt } from "../src/lib/ai-notes.ts";

test("cleanPdfText repairs PDF copy damage without breaking real hyphens", () => {
  assert.equal(cleanPdfText("whole slide im-\nages are giga- pixel ﬁles [12]  ."), "Whole slide images are gigapixel files.");
  assert.equal(cleanPdfText("COVID-19 and T- and B-cell counts [3, 4] rose"), "COVID-19 and T- and B-cell counts rose");
  assert.equal(cleanPdfText("  ( see Fig. 2 )\nfor details"), "(see Fig. 2) for details");
});

test("AI reply parser tolerates fences and drops unknown ids", () => {
  const reply = 'Here you go:\n```json\n[{"id":"a","text":"- AUC 0.98 on held-out slides."},{"id":"zz","text":"x"}]\n```';
  assert.deepEqual(parseReply(reply, ["a", "b"]), [{ id: "a", text: "AUC 0.98 on held-out slides." }]);
  assert.throws(() => parseReply("no json", ["a"]));
});

test("AI request validation caps size and defaults the mode", () => {
  assert.equal(typeof validateRequest({ passages: [] }), "string");
  const ok = validateRequest({ passages: [{ id: "a", text: "x".repeat(5000) }] });
  assert.ok(typeof ok !== "string" && ok.mode === "concise" && ok.passages[0].text.length === 4000);
  assert.match(buildPrompt({ mode: "clean", passages: [{ id: "a", text: "t" }] }).system, /Keep the author's wording/);
});

import { normalizeOrcid, splitName, fromOrcidWorks, fromOpenAlexWork, fromOpenAlexAuthors, enrichWorks, parseBibTeX } from "../src/lib/publications.ts";

test("normalizeOrcid accepts URLs and checks the checksum", () => {
  assert.equal(normalizeOrcid("https://orcid.org/0000-0002-1825-0097"), "0000-0002-1825-0097");
  assert.equal(normalizeOrcid("0000000218250097"), "0000-0002-1825-0097");
  assert.equal(normalizeOrcid("0000-0002-1825-0098"), null);
  assert.equal(normalizeOrcid("0000-0002-1694-233X"), "0000-0002-1694-233X");
  assert.equal(normalizeOrcid("orcid.org/0009-0003-1291-3798"), "0009-0003-1291-3798");
});

test("splitName handles both name orders", () => {
  assert.deepEqual(splitName("Amith V Paruchuri"), { family: "Paruchuri", given: "Amith V" });
  assert.deepEqual(splitName("Paruchuri, Amith"), { family: "Paruchuri", given: "Amith" });
});

test("ORCID works become papers, deduped, enriched from OpenAlex", () => {
  const orcid = { group: [
    { "work-summary": [{ title: { title: { value: "Deep  learning in pathology" } }, "publication-date": { year: { value: "2024" } }, "journal-title": { value: "Lancet Digit Health" }, type: "journal-article", "external-ids": { "external-id": [{ "external-id-type": "doi", "external-id-value": "https://doi.org/10.1016/X.Y.2024" }] } }] },
    { "work-summary": [{ title: { title: { value: "Deep learning in pathology" } }, type: "journal-article" }] },
    { "work-summary": [{ title: { title: { value: "A poster" } }, type: "conference-paper", "publication-date": null }] },
  ] };
  const works = fromOrcidWorks(orcid);
  assert.equal(works.length, 2);
  assert.equal(works[0].doi, "10.1016/x.y.2024");
  const oa = fromOpenAlexWork({ doi: "https://doi.org/10.1016/x.y.2024", display_name: "Deep learning in pathology", publication_year: 2024, authorships: [{ author: { display_name: "Amith V Paruchuri" } }], biblio: { volume: "6", first_page: "10", last_page: "20" } })!;
  const [first] = enrichWorks(works, [oa]);
  assert.deepEqual(first.authors, [{ family: "Paruchuri", given: "Amith V" }]);
  assert.equal(first.pages, "10-20"); // ORCID had no pages, so OpenAlex fills them
  assert.equal(enrichWorks(works, [oa])[0].volume, "6");
});

test("OpenAlex author search results are simplified", () => {
  const c = fromOpenAlexAuthors({ results: [{ id: "https://openalex.org/A5033597500", display_name: "Amith V Paruchuri", works_count: 11, orcid: null, last_known_institutions: [{ display_name: "AIIMS" }] }] });
  assert.deepEqual(c[0], { id: "A5033597500", name: "Amith V Paruchuri", institution: "AIIMS", works: 11, orcid: null });
});

test("parseBibTeX reads a Google Scholar export", () => {
  const bib = `@article{paruchuri2024deep,
  title={Deep learning for {OSCC} grading: a \\& b},
  author={Paruchuri, Amith and Singh, Amrit Pal and others},
  journal={Journal of Pathology Informatics},
  volume={15}, number = {2},
  pages={100--110},
  year={2024},
  publisher={Elsevier}
}
@inproceedings{x2023, title = "Spectrograms and schizophrenia", author = "Doe, Jane", booktitle = {AAN}, year = 2023, doi = {10.1000/ABC.1}}`;
  const w = parseBibTeX(bib);
  assert.equal(w.length, 2);
  assert.equal(w[0].title, "Deep learning for OSCC grading: a & b");
  assert.deepEqual(w[0].authors, [{ family: "Paruchuri", given: "Amith" }, { family: "Singh", given: "Amrit Pal" }]);
  assert.equal(w[0].pages, "100–110");
  assert.equal(w[0].issue, "2");
  assert.equal(w[1].journal, "AAN");
  assert.equal(w[1].doi, "10.1000/abc.1");
  assert.equal(w[1].year, 2023);
});

import { buildGraph, neighbours, LOOSE_ID } from "../src/lib/graph-model.ts";

test("research graph: decks are hubs, shared papers bridge decks", () => {
  const P = (id: string, decks: string[], tags: string[] = [], authors = [{ family: "Doe", given: "Jane" }]) => ({
    id, title: id, authors, year: 2020, status: "read", is_mine: false,
    collection_papers: decks.map((d) => ({ collection_id: d })), paper_tags: tags.map((t) => ({ tag_id: t })),
    note_sections: [{ id: "s", color: null, position: 0, has_notes: true }],
  }) as never;
  const papers = [P("a", ["d1"], ["t"]), P("b", ["d1", "d2"], ["t"]), P("c", ["d2"]), P("loose", [])];
  const cols = [{ id: "d1", name: "One" }, { id: "d2", name: "Two" }] as never;
  const g = buildGraph(papers, cols, [{ id: "t", name: "MIL" }] as never, { tagThreads: true });
  const decks = g.nodes.filter((n) => n.kind === "deck").map((n) => n.id);
  assert.deepEqual(decks, ["deck:d1", "deck:d2", LOOSE_ID]);
  assert.equal(g.links.filter((l) => l.kind === "member").length, 5); // b belongs to two decks
  const deckLink = g.links.find((l) => l.kind === "deck")!;
  assert.equal(deckLink.label, "1 shared paper");
  assert.equal(g.links.filter((l) => l.kind === "tag").length, 1);
  assert.ok(neighbours(g, "paper:b").has("deck:d2"));
  // focusing a deck keeps its papers and the decks they reach, not unrelated loose papers
  const f = buildGraph(papers, cols, [], { focusDeck: "d1" });
  assert.deepEqual(f.nodes.filter((n) => n.kind === "paper").map((n) => n.id).sort(), ["paper:a", "paper:b"]);
  assert.ok(f.nodes.some((n) => n.id === "deck:d2"));
  // author threads join every pair of papers that share an author (4 papers by Doe -> 6 threads)
  const ga = buildGraph(papers, cols, [], { authorThreads: true });
  assert.equal(ga.links.filter((l) => l.kind === "author").length, 6);
});
