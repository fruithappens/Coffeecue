// SignPage.js — the express-table sign, paper AND digital.
//
//   /sign?title=FLAT WHITE&sub=Full cream · help-yourself sugar
//
// Two uses, one page (Steve):
//   - PAPER: hit Print → clean A4 landscape sign for the table.
//   - DIGITAL: fullscreen it on any spare tablet/TV → live signage.
// Public route (it's signage), no data access, text comes from the URL.
import React from 'react';
import { useSearchParams } from 'react-router-dom';

const SignPage = () => {
  const [params] = useSearchParams();
  const title = (params.get('title') || 'FLAT WHITE').slice(0, 40);
  const sub = (params.get('sub') || '').slice(0, 80);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 1cm; }
        }
      `}</style>
      <div className="text-[11vw] leading-none font-extrabold tracking-tight text-gray-900 uppercase break-words max-w-full">
        {title}
      </div>
      {sub && (
        <div className="text-[3.5vw] mt-6 text-gray-600 font-medium">
          {sub}
        </div>
      )}
      <div className="no-print fixed bottom-4 right-4 flex gap-2">
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold shadow"
          onClick={() => window.print()}
        >
          Print A4 sign
        </button>
        <button
          className="bg-gray-700 text-white px-4 py-2 rounded-lg font-semibold shadow"
          onClick={() => {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen();
          }}
        >
          Fullscreen (digital sign)
        </button>
      </div>
      <div className="no-print fixed bottom-4 left-4 text-xs text-gray-400 max-w-xs text-left">
        Change the wording in the address bar: ?title=CAPPUCCINO&amp;sub=your text
      </div>
    </div>
  );
};

export default SignPage;
