# Answer guidelines (AFS Examples and Reference, sections 1, 3 and 4)

## Notes that apply to all scenarios

- The scenarios are constructed from the supplied application material. They are not real AFS client records and come without measured data.
- An enquiry contains everything the client has said. Anything not stated is unknown: ask about it or state it as an explicit assumption, never treat it as fact.
- Some enquiries ask for more certainty than the facts allow. A good answer notices this and says so.

# 3. Answer structure and good practice

The brief lists what the assistant should produce for each case. The structure below is one way to organise it. Section names are a suggestion; any clear structured format (JSON, Markdown, a web view) works.

| Section | Content |
|---|---|
| Requirements | Facts the client stated and the key unknowns, kept separate. |
| Clarification questions | Prioritised: first the questions whose answers could change the method or the setup. |
| Recommendation | Methods or combinations worth testing, each with its reason and the conditions under which it applies. A decision status: provisional assessment, insufficient information, or outside the supported scope. |
| Measurement concept | High-level probe and geometry (for example ATR, diffuse reflection, transmission or transflection), measurement location and fiber link. |
| Spectral range | The relevant range in correct units. A nominal method range is not the range of a specific instrument, fiber or probe. |
| Risks and uncertainty | What could make the recommendation wrong and which assumptions it rests on. |
| Feasibility plan | Representative samples or process states, independent reference measurements, what is compared, and the basis for the go / no-go decision. |
| Sources | For each important claim: source and page (section 4). |

“Insufficient information” can be the right answer

If the known facts cannot justify a method choice, say so, ask the questions that would decide it and propose the next step. A conditional shortlist with explicit assumptions is also fine. An honest provisional plan is more useful than a final configuration built on missing facts.

## Do not invent
- measured spectra or experimental results;
- accuracy, detection limits, response times, fiber lengths or other performance figures that no source supports;
- the client’s sample composition, concentrations or answers to your questions;
- AFS product codes, prices or component ratings that are not in the sources;
- guarantees: a published application is a reason to test a method, not proof that it will work for a new customer.

## Common mistakes
- A central recommendation that rests on an invented specification or performance figure, or on a source that does not say what is claimed.
- Citations that are unrelated or stretched beyond their scope, for example a laboratory study cited as proof of process or clinical readiness.
- Missing client facts filled in as if they had been given.
- Treating length and confidence as quality: a short, well-founded answer is more useful than a long, assertive one.

Different methods can be equally defensible for the same case. What matters is that the reasoning, the assumptions and the proposed experiment are justified.

# 4. AFS sources and citations

| ID | File | Content and how to use it |
|---|---|---|
| S01 | S01_Multispectral_ Laboratory.pdf (19 pages) | Overview of optical analysis methods and application examples. Main technical source. Methods p.2–6 (comparison table p.6), combining methods p.7–9, measurement kits and probes p.10–12, application cases p.13–18 (medical, pharmaceutical, bioprocess, dairy). |
| S02 | S02_AFS_Process_ Control_Slides.pdf (20 slides) | AFS slides on process control: fiber types and transmission ranges (p.6–10), probes, application slides (water in petroleum p.13, API in polymer extrusion p.14), combined probes (p.15–16). Mostly images: text extraction returns little, so read the slides visually. |
| S03 | S03_LED_Kidney_ Study_2017.pdf | Research paper: LED-based NIR sensor for kidney tumour diagnostics, tested on 14 in vitro samples from 7 patients. A proof of concept. |
| S04 | S04_Combi_MIR_ Fluorescence_2021.pdf | Research paper: fiber probe for simultaneous MIR (ATR) and fluorescence measurement, demonstrated on model biological tissues. |
| S05 | S05_AFS_Flyer.pdf | Company and product overview. Business context, not evidence of technical performance. |
| S06 | S06_Laboratory_Link.txt | Link to the laboratory website (https://mirphotonics.com/laboratory/). Business context. |
| Table | AFS_method_comparison_ table.xlsx | Machine-readable transcription of S01 Table 1 (p.6): method, measurement technique, physical phenomenon, sample type, optical path, qualitative sensitivity, selectivity and cost. Use it instead of extracting p.6 from the PDF, where the columns get scrambled. |

## How to cite
- Cite as S01 p.10: the page is the 1-based PDF page, counting the title page. For slides, S02 p.13 is slide 13. For the table, cite S01 Table 1 (p.6).
- Check that the cited page actually supports the claim at the stated scope (laboratory or process, sample type, prototype or product). A source ID next to a sentence is not proof.
- Where the AFS materials cover a point, cite them. If you also use an external source, include the quoted passage and the link, so an expert can check it without opening the page.

## Suggested reading order

Start with the method pages of S01 (p.2–12), then its application cases (p.13–18) and the S02 slides. S03 and S04 are research papers: they add context and show the limits of what has been demonstrated. S05 and S06 are business context.

## Practical tips
- S02 is mostly images, so PDF text extraction returns little more than slide titles. Read the key slides visually, for example with a vision-capable model, or write your own notes.
- Use AFS_method_comparison_table.xlsx rather than parsing S01 p.6 from the PDF.
- Keep client facts, sourced claims, assumptions and proposed experiments visibly separate. It makes the answer easy for an expert to review.
- Test the hard cases on purpose: missing information, an enquiry outside the sources, a premise that the sources contradict.
