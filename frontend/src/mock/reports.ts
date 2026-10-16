import type { Citation, Claim, Report } from '../api/types'

// Mock fixtures for working without the backend. D01/D02 are the organizers' worked examples
// (AFS_Examples_and_Reference.docx, section 2) mapped to the Report type; SOIL is a hand-written
// fixture for the soil example in the challenge brief. None of this is assistant output.

const c = (source: Citation['source'], page: number, label?: string, quote?: string): Citation =>
  ({ source, page, label: label ?? `${source} p.${page}`, ...(quote ? { quote } : {}) })
const TABLE: Citation = { source: 'TABLE', page: null, label: 'S01 Table 1 (p.6)' }
const fact = (text: string): Claim => ({ text, kind: 'fact', citations: [] })
const sourced = (text: string, ...citations: Citation[]): Claim => ({ text, kind: 'sourced', citations })
const infer = (text: string): Claim => ({ text, kind: 'inference', citations: [] })
const assume = (text: string): Claim => ({ text, kind: 'assumption', citations: [] })
const noChecks = { passed: true, revisions: 0, checks: [] }

export const D01: Report = {
  case_id: 'D01',
  enquiry: 'We manufacture tablets from a powder blend containing an active pharmaceutical ingredient and excipients. Laboratory checks tell us whether the blend is on target, but results arrive after the material has moved through the press. We want to assess whether a fiber based measurement in the feed frame could follow API concentration changes. Our first pilot should compare reasonable measurement options before we commit to production equipment.',
  decision_status: 'provisional',
  decision_rationale: 'Provisional feasibility assessment.',
  summary: '',
  requirements: {
    stated_facts: [
      fact('Powder blend with API and excipients.'),
      fact('API concentration is the target.'),
      fact('Measurement in the feed frame is preferred.'),
      fact('Independent laboratory checks exist.'),
      fact('The pilot should compare options before buying equipment.'),
    ],
    key_unknowns: ['API and excipients', 'Concentration range', 'Acceptance limits', 'Required response time', 'Reference assay uncertainty', 'Access and cleaning conditions'],
    client_premises: [],
  },
  clarification_questions: [
    { question_id: 'q1', priority: 1, affects: 'method', why_it_matters: '', text: 'Which API, excipients and concentration range are involved, and which changes must be distinguished?' },
    { question_id: 'q2', priority: 1, affects: 'plan', why_it_matters: '', text: 'Which assay, uncertainty and sampling time provide the reference concentrations?' },
    { question_id: 'q3', priority: 2, affects: 'plan', why_it_matters: '', text: 'Which formulation, particle and operating changes occur between runs?' },
    { question_id: 'q4', priority: 2, affects: 'acceptance', why_it_matters: '', text: 'What response time, acceptance limits, access and cleaning conditions apply?' },
  ],
  assumptions: [],
  user_answers: [],
  recommendations: [
    {
      method: 'NIR', technique: 'diffuse reflection probe', role: 'primary', conditions: [], citations: [],
      rationale: [
        sourced('The supplied pharmaceutical example supports NIR reflection for blend concentration in powders.', c('S01', 14, 'S01 p.14–15')),
        sourced('A matrix-specific calibration must be built and tested.', c('S01', 10)),
      ],
    },
    {
      method: 'Raman', technique: 'Raman probe', role: 'comparison', conditions: [], citations: [],
      rationale: [
        sourced('The same application family supports Raman as a comparison candidate.', c('S01', 14, 'S01 p.14–15')),
        sourced('Check fluorescence background and signal quality.', c('S01', 11)),
      ],
    },
    {
      method: 'NIR + Raman', technique: 'combined probe, to be confirmed', role: 'combination', citations: [],
      conditions: ['Consider only after each method has been assessed on its own.'],
      rationale: [sourced('Whether the combination adds value for this formulation is a hypothesis to test.', c('S01', 14, 'S01 p.14–15'))],
    },
  ],
  measurement_concept: {
    probe_geometry: [
      sourced('A powder interface for each candidate, for example a diffuse reflection probe for NIR and a Raman probe.', TABLE),
      infer('A combined probe could sample the same spot, but probe type, installation and optical configuration need AFS confirmation.'),
    ],
    location: [fact('In the tablet press feed frame.')],
    fiber_link: [],
  },
  spectral_ranges: [
    { method: 'NIR', range_text: '780–2500 nm (nominal method range)', note: 'Specify only the usable range of the selected system.', citations: [c('S01', 10)] },
    { method: 'Raman', range_text: 'Excitation wavelength and Raman shift stated separately', note: 'Do not pick an optimal band without sample spectra.', citations: [] },
  ],
  risks: [
    infer('A change of API or excipients can invalidate a calibration.'),
    infer('Physical variation of the powder (particle size, density, flow) changes the signal.'),
    infer('A combination of methods does not guarantee a gain for every formulation.'),
    infer('No accuracy, update rate or equipment compatibility has been confirmed.'),
  ],
  feasibility_plan: {
    objective: '',
    samples: ['Representative blends across the client-agreed API range and the relevant physical variation'],
    reference_measurements: ['Independent API reference assays, with timing information'],
    steps: [
      { order: 1, title: 'Prepare representative blends', description: 'Prepare representative blends across the client-agreed API range and the relevant physical variation.', citations: [] },
      { order: 2, title: 'Record spectra with reference assays', description: 'Record spectra from each candidate together with independent API reference assays and timing information.', citations: [] },
      { order: 3, title: 'Build and validate models', description: 'Build single-method models first, then a combined model; validate on held-out runs or batches.', citations: [] },
      { order: 4, title: 'Compare against requirements', description: 'Compare prediction error, bias and the ability to follow changes against the client’s requirements.', citations: [] },
    ],
    comparison: 'Prediction error, bias and the ability to follow changes, against the client’s requirements.',
    go_no_go: 'Agree numerical acceptance criteria with the client before the test. Choose the simplest configuration that meets them on independent material.',
  },
  sources: [TABLE, c('S01', 10), c('S01', 11), c('S01', 14, 'S01 p.14–15')],
  verification: noChecks,
  meta: { model: 'Organizer worked example (mock fixture)', mode: 'batch', generated_at: '2026-10-11T00:00:00Z', duration_s: 0 },
}

export const D02: Report = {
  case_id: 'D02',
  enquiry: 'We produce an opaque, concentrated milk product that flows through a processing line. We currently sample it for fat and protein analysis and would like earlier information about composition changes. Product temperature and texture vary during production. We want an initial spectroscopy concept and a practical comparison experiment, while retaining our laboratory checks.',
  decision_status: 'provisional',
  decision_rationale: 'Provisional feasibility assessment.',
  summary: '',
  requirements: {
    stated_facts: [
      fact('Opaque concentrated milk product in a flowing line.'),
      fact('Fat and protein are the targets.'),
      fact('Temperature and texture vary.'),
      fact('Laboratory checks remain available.'),
    ],
    key_unknowns: ['Product types and composition ranges', 'Required accuracy and delay', 'Installation point', 'Cleaning regime'],
    client_premises: [],
  },
  clarification_questions: [
    { question_id: 'q1', priority: 1, affects: 'method', why_it_matters: '', text: 'Which product types, composition ranges and reference assays are involved?' },
    { question_id: 'q2', priority: 1, affects: 'method', why_it_matters: '', text: 'How do temperature, texture, homogenisation state and air bubbles vary?' },
    { question_id: 'q3', priority: 2, affects: 'setup', why_it_matters: '', text: 'Can an optical interface see a representative sample and be kept clean?' },
    { question_id: 'q4', priority: 2, affects: 'acceptance', why_it_matters: '', text: 'What accuracy, delay, installation and cleaning limits apply?' },
  ],
  assumptions: [],
  user_answers: [],
  recommendations: [
    {
      method: 'NIR', technique: 'diffuse reflection probe', role: 'primary', citations: [],
      rationale: [sourced('The supplied dairy example supports NIR reflection for opaque or concentrated products.', c('S01', 17))],
      conditions: ['Consider another geometry only if the measured optical behaviour justifies it [S01 p.18].'],
    },
  ],
  measurement_concept: {
    probe_geometry: [sourced('Test a reflection interface on representative laboratory samples before specifying the process installation.', TABLE)],
    location: [infer('Confirm contact geometry, fouling control and cleaning with AFS and the client.')],
    fiber_link: [],
  },
  spectral_ranges: [
    { method: 'NIR', range_text: '780–2500 nm (general NIR range)', note: 'Not a required full coverage. Check which bands the instrument and fiber actually cover, then inspect the sample spectra.', citations: [c('S01', 10)] },
  ],
  risks: [
    sourced('Temperature, texture and scattering changes can mimic composition changes.', c('S01', 17)),
    infer('Fat and protein each need their own independent reference results.'),
    infer('A reflection spectrum is not yet a fat or protein calibration.'),
    infer('Interface ratings, signal stability and achievable errors are unknown.'),
  ],
  feasibility_plan: {
    objective: '',
    samples: ['Representative samples across production variation'],
    reference_measurements: ['Independent fat results', 'Independent protein results'],
    steps: [
      { order: 1, title: 'Collect representative samples', description: 'Collect representative samples with independent fat and protein results across production variation.', citations: [] },
      { order: 2, title: 'Compare optical geometries', description: 'Compare suitable optical geometries, first under controlled and then under realistic conditions.', citations: [] },
      { order: 3, title: 'Separate physical effects from composition', description: 'Separate the effect of physical changes (temperature, texture) from composition.', citations: [] },
      { order: 4, title: 'Validate on independent runs', description: 'Validate on independent production runs against client-agreed error and maintenance requirements.', citations: [] },
    ],
    comparison: 'Composition error and bias on independent production runs.',
    go_no_go: 'Composition error and bias on independent production runs, together with maintenance and response needs. The acceptance targets come from the client; none is invented here.',
  },
  sources: [TABLE, c('S01', 10), c('S01', 17), c('S01', 18)],
  verification: noChecks,
  meta: { model: 'Organizer worked example (mock fixture)', mode: 'batch', generated_at: '2026-10-11T00:00:00Z', duration_s: 0 },
}

export const SOIL: Report = {
  enquiry: 'We need to monitor moisture and hydrocarbon contamination in soil. Measurements should be remote and the environment may be humid and dirty.',
  decision_status: 'insufficient_information',
  decision_rationale: 'Soil type, contamination levels, sample access and the distance to the analyzer are unknown, and they decide between NIR reflection and a mid-IR approach.',
  summary: 'NIR diffuse reflection is the most promising first test for moisture: AFS material shows fiber NIR moisture sensing and robust silica links for remote installations. Hydrocarbons need a comparison, because NIR may not follow low levels while mid-IR has more specific bands but needs IR fibers and contact. Treat this as a conditional shortlist until the open questions are answered.',
  requirements: {
    stated_facts: [
      fact('Moisture and hydrocarbon contamination in soil are the targets.'),
      fact('The measurement must be remote.'),
      fact('The environment may be humid and dirty.'),
    ],
    key_unknowns: [
      'Which hydrocarbons, and at what levels',
      'Distance to the analyzer, and whether the probe can touch the soil',
      'Reference methods for calibration',
      'Soil types and their variation',
      'Temperature, dirt load and cleaning access',
      'Required accuracy and update rate',
    ],
    client_premises: [
      {
        statement: 'A remote measurement will work in a humid, dirty environment.',
        verdict: 'unverified',
        explanation: 'Fiber links let the analyzer sit away from the measurement point, and robust silica cables are shown for process control. No supplied source covers soil probes under humidity and dirt, so window fouling must be tested first.',
        citations: [c('S02', 7, undefined, 'Robust 100-300m cables made with Silica fibers')],
      },
      {
        statement: 'Fiber optics allow the measurement to be made remotely.',
        verdict: 'supported',
        explanation: 'NIR works with standard optics and fiber probes, which suits remote measurements.',
        citations: [c('S01', 5)],
      },
    ],
  },
  clarification_questions: [
    { question_id: 'q1', priority: 1, affects: 'method', text: 'Which hydrocarbons do you expect, at what levels, and do you need detection or quantification?', why_it_matters: 'Decides whether NIR overtone bands may be enough or the more specific mid-IR bands are needed.' },
    { question_id: 'q2', priority: 1, affects: 'setup', text: 'How far is the analyzer from the measurement point, and can the probe touch the soil?', why_it_matters: 'Sets the fiber family and length, and whether a contact probe is possible at all.' },
    { question_id: 'q3', priority: 1, affects: 'plan', text: 'Which laboratory methods give reference values for moisture and hydrocarbons?', why_it_matters: 'Without independent reference values there is nothing to calibrate or validate against.' },
    { question_id: 'q4', priority: 2, affects: 'plan', text: 'Which soil types occur, and how much do particle size, organic matter and colour vary?', why_it_matters: 'Physical variation changes diffuse reflection spectra and must be covered by the calibration set.' },
    { question_id: 'q5', priority: 2, affects: 'setup', text: 'What temperatures, dirt load and cleaning access apply at the probe?', why_it_matters: 'Window material and cleaning decide long-term signal stability.' },
    { question_id: 'q6', priority: 3, affects: 'acceptance', text: 'What update rate and accuracy would make the measurement useful to you?', why_it_matters: 'These become the acceptance criteria for the go / no-go decision.' },
  ],
  assumptions: [
    '“Remote” means the analyzer sits away from the measurement point with a fiber link, not stand-off sensing.',
    'Soil can be presented to a probe window in contact or near contact.',
  ],
  user_answers: [],
  recommendations: [
    {
      method: 'NIR', technique: 'diffuse reflection probe', role: 'primary', citations: [],
      rationale: [
        sourced('AFS material shows an NIR-LED fiber sensor controlling moisture in bulk materials.', c('S02', 12)),
        sourced('Table 1 lists NIR diffuse reflection for scattering media and powders.', TABLE),
        sourced('NIR penetrates scattering samples by several millimetres and works with standard optics and fiber probes, which suits remote installations.', c('S01', 5)),
        infer('Whether NIR can follow hydrocarbons at the client’s levels is unknown.'),
      ],
      conditions: ['A probe can touch or sit close to a representative soil surface.'],
    },
    {
      method: 'MIR ATR', technique: 'ATR probe', role: 'comparison', citations: [],
      rationale: [
        sourced('Mid-IR spectra contain well-defined absorption bands, which helps identify hydrocarbons.', c('S01', 5)),
        sourced('Hydrocarbon bands at 3.0–4.5 µm are marked on the AFS spectral overview.', c('S02', 18)),
        infer('ATR needs soil in contact with the crystal, where dirt and fouling are a risk.'),
        sourced('Needs IR fibers such as chalcogenide or PIR instead of silica.', c('S02', 6)),
      ],
      conditions: ['Hydrocarbons must be identified or quantified at levels NIR cannot follow.', 'The required link length is feasible with IR fibers.'],
    },
    {
      method: 'NIR + MIR', technique: 'two probes or a combined probe', role: 'combination', citations: [],
      rationale: [
        sourced('Combining methods can add information from different sample depths.', c('S01', 8)),
        infer('Any gain is a hypothesis to test against the best single method.'),
      ],
      conditions: ['Only if neither single method meets the requirements.'],
    },
    {
      method: 'Raman', technique: 'Raman probe', role: 'not_recommended', citations: [], conditions: [],
      rationale: [
        sourced('The Raman signal is weak and can be overlapped by luminescence of organic compounds.', c('S01', 11)),
        infer('Soil organic matter makes this likely, so Raman is not a first test.'),
      ],
    },
  ],
  measurement_concept: {
    probe_geometry: [
      sourced('Diffuse reflection probe with a protected window for NIR.', TABLE),
      sourced('ATR probe for the mid-IR comparison.', c('S01', 10)),
    ],
    location: [
      assume('Soil surface or sampled cores, in contact or near contact.'),
      infer('Spectrometer in a protected enclosure away from the measurement point.'),
    ],
    fiber_link: [
      sourced('Robust silica cables are shown for NIR process control over long distances.', c('S02', 7, undefined, 'Robust 100-300m cables made with Silica fibers')),
      sourced('Mid-IR would need an IR fiber such as chalcogenide or PIR; the link length is not yet known.', c('S02', 6)),
    ],
  },
  spectral_ranges: [
    { method: 'NIR', range_text: '780–2500 nm (nominal method range)', note: 'Moisture-related bands at 1.3–2.2 µm are marked on the AFS overview.', citations: [c('S01', 10, undefined, 'NIR spectra (780–2500 nm)'), c('S02', 18)] },
    { method: 'MIR ATR', range_text: '4000–400 cm⁻¹ (2.5–25 µm, nominal)', note: 'The usable range depends on the fiber and the ATR crystal.', citations: [c('S01', 9)] },
  ],
  risks: [
    infer('Soil type, particle size and organic matter can change the spectra more than the targets do.'),
    infer('Window fouling by wet, dirty soil makes the signal drift.'),
    infer('Hydrocarbon levels may be below what NIR can follow.'),
    sourced('Vis-NIR silica fibers transmit only up to about 2.4 µm, so an existing silica link cannot serve a mid-IR probe.', c('S02', 6)),
    infer('A calibration may not transfer between sites or seasons.'),
  ],
  feasibility_plan: {
    objective: 'Find out whether NIR reflection can follow moisture and hydrocarbons on the client’s soils, and whether mid-IR is needed for hydrocarbons.',
    samples: ['Client soils covering the expected soil types, moisture range and contamination levels', 'A spiked series where real contaminated samples are missing'],
    reference_measurements: ['Client’s laboratory moisture results', 'Client’s laboratory hydrocarbon results'],
    steps: [
      { order: 1, title: 'Build a representative sample set', description: 'Collect soils across the client’s types and ranges; add spiked samples where real ones are missing.', citations: [] },
      { order: 2, title: 'Compare NIR reflection and mid-IR ATR in the lab', description: 'Record spectra of the same samples with both methods under controlled conditions and build a first model per target.', citations: [TABLE] },
      { order: 3, title: 'Test under realistic conditions', description: 'Repeat with humid, dirty samples and a protected window; track drift and how often cleaning is needed.', citations: [] },
      { order: 4, title: 'Validate on independent samples', description: 'Validate the best single method on samples not used for calibration, ideally from another site or time.', citations: [] },
    ],
    comparison: 'Prediction error and bias for moisture and hydrocarbons per method, and signal stability under dirt and humidity.',
    go_no_go: 'Go to a field pilot with the simplest configuration that meets error, bias and stability limits agreed with the client. If neither method does, revisit the method choice or the sampling concept before any field work.',
  },
  sources: [c('S01', 5), c('S01', 8), c('S01', 9), c('S01', 10), c('S01', 11), c('S02', 6), c('S02', 7), c('S02', 12), c('S02', 18), TABLE],
  verification: {
    passed: true,
    revisions: 2,
    checks: [
      { name: 'Citations resolve to real pages', passed: true, details: '16 citations checked against the knowledge base.' },
      { name: 'No invented performance figures', passed: true, details: 'A detection limit in revision 1 was removed.' },
      { name: 'Citation scope', passed: true, details: 'An S03 (in vitro) citation for a soil claim was removed.' },
      { name: 'Client facts kept separate from assumptions', passed: true, details: '' },
    ],
  },
  meta: { model: 'mock (no LLM)', mode: 'interactive', generated_at: '', duration_s: 18 },
}
