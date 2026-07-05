// Build-time parser: turns the two placement markdown docs into structured JSON
// consumed by the public /prep page. Re-run after refreshing scripts/prep-sources/*.md.
//
//   node scripts/build-prep-data.mjs
//
// Emits apps/web/src/data/prep-questions.json. Fails loudly if counts regress.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'prep-sources');
const OUT = join(__dirname, '..', 'src', 'data', 'prep-questions.json');

const COMPANY_MAP = {
  DELOITTE: 'Deloitte',
  KPMG: 'KPMG',
  'ORACLE NETSUITE': 'Oracle NetSuite',
  SAPIENS: 'Sapiens',
  CAPGEMINI: 'Capgemini',
  COGNIZANT: 'Cognizant',
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const unesc = (s) => s.replace(/\\([&$~#%_{}])/g, '$1').trim();

function canonCompany(raw) {
  // "1. DELOITTE — Aptitude Test" -> "Deloitte"
  let t = raw.replace(/^\d+\.\s*/, '').replace(/\s*—.*$/, '').trim();
  return COMPANY_MAP[t.toUpperCase()] ?? t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function interviewCategory(raw) {
  const t = raw.toLowerCase();
  if (t.includes('process overview')) return null;
  if (t.includes('hr') || t.includes('fit')) return 'HR / Fit';
  if (t.includes('situational') || t.includes('star')) return 'Situational';
  if (t.includes('case') || t.includes('domain')) return 'Case / Domain';
  if (t.includes('technical')) return 'Technical';
  return null;
}
// Interview H2 that names a role rather than a category.
const isRoleHeading = (raw) => /^\d+[A-Z]\./.test(raw) || /^role:/i.test(raw);

function aptitudeSection(raw) {
  // strip "(...)" notes and " — ..." suffixes, then map to canonical buckets
  const t = raw.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*—.*$/, '').trim();
  const l = t.toLowerCase();
  if (/quantitative|numerical/.test(l)) return 'Quantitative';
  if (/logical/.test(l)) return 'Logical Reasoning';
  if (/verbal|english/.test(l)) return 'Verbal';
  if (/data interpretation/.test(l)) return 'Data Interpretation';
  if (/sql/.test(l)) return 'SQL';
  if (/java|oop/.test(l)) return 'Java / OOP';
  if (/pseudocode|technical/.test(l)) return 'Coding / Pseudocode';
  if (/communication/.test(l)) return 'Communication';
  if (/game/.test(l)) return 'Game-Based';
  return t;
}

function extractSource(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\[SOURCE:\s*([\s\S]*?)\]/);
    if (m) return { idx: i, source: m[1].trim() };
  }
  return { idx: -1, source: null };
}
// Topic heuristic: the segment between em-dashes inside a SOURCE tag, if it looks like a topic.
function topicFromSource(src) {
  if (!src) return null;
  const parts = src.split('—').map((s) => s.trim());
  for (const p of parts.slice(1)) {
    if (p.length < 40 && !/confirmed|verbatim|review|glassdoor|http|\d{4}/i.test(p)) return p;
  }
  return null;
}

function splitBlocks(text) {
  return text.split(/\n\s*\*\*\*\s*\n/).map((b) => b.replace(/\r/g, ''));
}

// ── INTERVIEW ────────────────────────────────────────────────────────────────
function parseInterview(md) {
  const out = [];
  const overviews = {};
  let company = null, role = null, category = null;
  for (const block of splitBlocks(md)) {
    const lines = block.split('\n');
    const content = [];
    for (const line of lines) {
      const h = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (!h) { content.push(line); continue; }
      const level = h[1].length, txt = h[2].trim();
      if (level === 1) { company = canonCompany(txt); role = null; category = null; }
      else if (level === 2) {
        if (isRoleHeading(txt)) { role = txt.replace(/^role:\s*/i, '').replace(/^\d+[A-Z]\.\s*/, '').trim(); category = null; }
        else { const c = interviewCategory(txt); category = c ?? (/process overview/i.test(txt) ? 'Process Overview' : category); }
      } else if (level === 3) { category = interviewCategory(txt) ?? category; }
    }
    const body = content.join('\n').trim();
    if (!body) continue;
    const stem = body.match(/^\*\*Q(\d+)\.\s*([\s\S]*?)\*\*\s*$/m);
    if (stem && /^\*\*Q\d+\./.test(body)) {
      const bl = body.split('\n');
      const { idx, source } = extractSource(bl);
      const answer = (idx >= 0 ? bl.slice(idx + 1) : bl.slice(1)).join('\n').trim();
      out.push({
        id: `intv-${slug(company)}-${stem[1]}`,
        company, role: role || null, category: category || 'Other',
        question: unesc(stem[2]).replace(/\s+/g, ' ').trim(),
        answerMarkdown: answer, source, topic: topicFromSource(source),
      });
    } else if (category === 'Process Overview' && company) {
      overviews[company] = ((overviews[company] || '') + '\n' + body).trim();
    }
  }
  return { questions: out, overviews };
}

// ── APTITUDE ─────────────────────────────────────────────────────────────────
function parseAptitude(md) {
  const out = [];
  const patterns = {};
  let company = null, section = null, inTips = false;
  for (const block of splitBlocks(md)) {
    const lines = block.split('\n');
    const content = [];
    for (const line of lines) {
      const h = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (!h) { content.push(line); continue; }
      const level = h[1].length, txt = h[2].trim();
      if (level === 1) {
        if (/general aptitude tips/i.test(txt)) { inTips = true; company = null; }
        else { company = canonCompany(txt); inTips = false; }
        section = null;
      } else if (level === 2) { section = aptitudeSection(txt); }
    }
    if (inTips) continue;
    const body = content.join('\n').trim();
    if (!body) continue;

    if (section && /test pattern/i.test(section) && company) {
      patterns[company] = ((patterns[company] || '') + '\n' + body).trim();
      continue;
    }
    if (!/^\*\*Q\d+\./.test(body)) continue;

    const bl = body.split('\n');
    const stem = bl[0].match(/^\*\*Q(\d+)\.\s*([\s\S]*?)\*\*\s*$/);
    if (!stem) continue;
    const { idx: srcIdx, source } = extractSource(bl);
    const sectionClean = section || 'Other';

    // option lines: "* (A) ..." or "* **(C) ...** ✓"
    const optIdxs = [];
    for (let i = 1; i < bl.length; i++) {
      if (/^\*\s+(\*\*)?\([A-D]\)/.test(bl[i])) optIdxs.push(i);
    }

    const base = {
      id: `apt-${slug(company)}-${stem[1]}`,
      company, section: sectionClean,
      question: unesc(stem[2]).replace(/\s+/g, ' ').trim(),
      source, topic: topicFromSource(source),
    };

    if (optIdxs.length >= 2) {
      const firstOpt = optIdxs[0];
      const promptMd = bl.slice(1, firstOpt).join('\n').trim(); // DI table / sub-question
      const options = optIdxs.map((i) => {
        const m = bl[i].match(/^\*\s+(\*\*)?\(([A-D])\)\s*([\s\S]*)$/);
        const correct = /✓/.test(bl[i]);
        const text = unesc(m[3].replace(/\*\*/g, '').replace(/✓/g, '').trim());
        return { label: m[2], text, correct };
      });
      // solution: from "**Solution:**" line until source (exclusive)
      let solution = null;
      const solStart = bl.findIndex((l) => /^\*\*Solution:\*\*/.test(l));
      if (solStart >= 0) {
        const solEnd = srcIdx >= 0 ? srcIdx : bl.length;
        solution = bl.slice(solStart, solEnd).join('\n').replace(/^\*\*Solution:\*\*\s*/, '').trim();
      }
      out.push({ ...base, type: 'mcq', promptMarkdown: promptMd || null, options, solutionMarkdown: solution, answerMarkdown: null });
    } else {
      const answer = (srcIdx >= 0 ? bl.slice(1, srcIdx) : bl.slice(1)).join('\n').trim();
      out.push({ ...base, type: 'open', promptMarkdown: null, options: null, solutionMarkdown: null, answerMarkdown: answer });
    }
  }
  return { questions: out, patterns };
}

// ── RUN ──────────────────────────────────────────────────────────────────────
const interviewMd = readFileSync(join(SRC, 'interview.md'), 'utf8');
const aptitudeMd = readFileSync(join(SRC, 'aptitude.md'), 'utf8');

const intv = parseInterview(interviewMd);
const apt = parseAptitude(aptitudeMd);

// company ordering
const order = ['Deloitte', 'KPMG', 'Oracle NetSuite', 'Sapiens', 'Capgemini', 'Cognizant'];
const byOrder = (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99);

const interviewCompanies = [...new Set(intv.questions.map((q) => q.company))].sort(byOrder);
const aptitudeCompanies = [...new Set(apt.questions.map((q) => q.company))].sort(byOrder);
const interviewCategories = [...new Set(intv.questions.map((q) => q.category))];
const aptitudeSections = [...new Set(apt.questions.map((q) => q.section))];

const data = {
  meta: {
    generatedFrom: ['Placement Interview Question Bank', 'Placement Aptitude Test Bank — All 6 Companies'],
    counts: {
      interview: intv.questions.length,
      aptitude: apt.questions.length,
      aptitudeMcq: apt.questions.filter((q) => q.type === 'mcq').length,
      aptitudeOpen: apt.questions.filter((q) => q.type === 'open').length,
    },
    interviewCompanies, aptitudeCompanies, interviewCategories, aptitudeSections,
  },
  interview: intv.questions,
  aptitude: apt.questions,
  overviews: intv.overviews,
  patterns: apt.patterns,
};

// ── ASSERTIONS ───────────────────────────────────────────────────────────────
const problems = [];
if (intv.questions.length < 90) problems.push(`interview count too low: ${intv.questions.length} (expected ~102)`);
if (apt.questions.length < 50) problems.push(`aptitude count too low: ${apt.questions.length} (expected ~63)`);
for (const q of apt.questions.filter((x) => x.type === 'mcq')) {
  const c = q.options.filter((o) => o.correct).length;
  if (c !== 1) problems.push(`MCQ ${q.id} has ${c} correct options (expected 1)`);
}
const dupIntv = intv.questions.length - new Set(intv.questions.map((q) => q.id)).size;
const dupApt = apt.questions.length - new Set(apt.questions.map((q) => q.id)).size;
if (dupIntv) problems.push(`${dupIntv} duplicate interview ids`);
if (dupApt) problems.push(`${dupApt} duplicate aptitude ids`);

writeFileSync(OUT, JSON.stringify(data, null, 2));

console.log('interview questions :', intv.questions.length, 'across', interviewCompanies.join(', '));
console.log('  categories        :', interviewCategories.join(' · '));
console.log('aptitude questions  :', apt.questions.length, `(mcq ${data.meta.counts.aptitudeMcq}, open ${data.meta.counts.aptitudeOpen}) across`, aptitudeCompanies.join(', '));
console.log('  sections          :', aptitudeSections.join(' · '));
console.log('patterns            :', Object.keys(apt.patterns).join(', '));
console.log('overviews           :', Object.keys(intv.overviews).join(', '));
console.log('wrote               :', OUT);
if (problems.length) { console.error('\nPARSE PROBLEMS:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('\nAll assertions passed ✓');
