// HelpCenter.js — Runner > Help (roadmap U4-2).
//
// A page per Runner section plus a few guides (helpArticles.js). The Help
// button in the Runner header opens the page for the section you were on;
// each page can take you back to that section. The text-ordering
// conversation reference that used to be the whole Help tab is one page.
import React from 'react';
import { ArrowRight, BookOpen, MessageSquare } from 'lucide-react';
import { GUIDES, SECTION_HELP } from './helpArticles';
import { NAV } from './runnerNav';
import SmsFlowReference from '../organiser/SmsFlowReference';

const SMS_PAGE = 'textOrdering';

function Page({ page, onOpen }) {
  return (
    <article className="bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
      <h2 className="text-2xl font-extrabold text-cq-roast">{page.title}</h2>
      {page.summary && <p className="text-cq-ink-2 mt-1">{page.summary}</p>}
      {page.steps && (
        <ol className="mt-4 space-y-2 list-decimal pl-6 text-cq-ink">
          {page.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}
      {page.points && (
        <ul className="mt-4 space-y-2 list-disc pl-6 text-cq-ink">
          {page.points.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
      {page.qa && (
        <dl className="mt-4 space-y-4">
          {page.qa.map(([q, a]) => (
            <div key={q}>
              <dt className="font-bold text-cq-roast">{q}</dt>
              <dd className="text-cq-ink-2 mt-0.5">{a}</dd>
            </div>
          ))}
        </dl>
      )}
      {page.open && page.open.section !== 'help' && (
        <button type="button" onClick={() => onOpen(page.open)}
          className="mt-6 h-11 px-4 inline-flex items-center gap-2 rounded-cq-md bg-cq-roast text-cq-cream font-bold hover:opacity-90">
          Open {SECTION_HELP[page.open.section]?.title || 'this section'} <ArrowRight size={16} />
        </button>
      )}
    </article>
  );
}

const HelpCenter = ({ article, onArticle, onOpen }) => {
  const sections = NAV.flatMap((g) => g.items).filter((i) => i.id !== 'help');
  const current = article === SMS_PAGE ? null
    : (GUIDES.find((g) => g.id === article) || SECTION_HELP[article] || GUIDES[0]);
  const isActive = (id) => (article || GUIDES[0].id) === id;
  const linkCls = (id) => `w-full text-left px-3 py-2 rounded-cq-md text-sm font-semibold ${
    isActive(id) ? 'bg-cq-roast text-cq-cream' : 'text-cq-ink-2 hover:bg-cq-wash'}`;

  return (
    <div className="cq grid gap-4 md:grid-cols-[240px_1fr]">
      <nav aria-label="Help pages" className="bg-cq-milk rounded-cq-lg shadow-cq-card p-3 self-start">
        <div className="px-3 pb-1 pt-1 text-xs font-extrabold uppercase tracking-[0.12em] text-cq-ink-3 flex items-center gap-1.5">
          <BookOpen size={14} /> Guides
        </div>
        {GUIDES.map((g) => (
          <button key={g.id} type="button" className={linkCls(g.id)} onClick={() => onArticle(g.id)}>{g.title}</button>
        ))}
        <button type="button" className={linkCls(SMS_PAGE)} onClick={() => onArticle(SMS_PAGE)}>
          <span className="inline-flex items-center gap-1.5"><MessageSquare size={14} /> The text-ordering conversation</span>
        </button>
        <div className="px-3 pb-1 pt-3 text-xs font-extrabold uppercase tracking-[0.12em] text-cq-ink-3">Each section</div>
        {sections.map((s) => (
          <button key={s.id} type="button" className={linkCls(s.id)} onClick={() => onArticle(s.id)}>
            {SECTION_HELP[s.id]?.title || s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {current ? <Page page={current} onOpen={onOpen} /> : <SmsFlowReference />}
      </div>
    </div>
  );
};

export default HelpCenter;
