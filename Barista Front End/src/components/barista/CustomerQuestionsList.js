// CustomerQuestionsList — presentational list of pending "BARISTA" SMS
// questions with an inline reply box. Data + handlers come from
// useCustomerQuestions(); this just renders. Designed to fill the Messages
// inbox panel body (flex column).
import React from 'react';
import { Send, Ban } from 'lucide-react';
import { parseServerDate } from '../../utils/orderUtils';

export default function CustomerQuestionsList({ items, replyDrafts, setReplyDrafts, sending, sendReply, blocking, blockSender }) {
  return (
    <div className="flex flex-col h-full">
      <div className="overflow-y-auto flex-1 p-3">
        {items.length === 0 ? (
          <div className="text-center text-cq-ink-3 py-8 px-4">
            No pending questions. When a customer texts <code>BARISTA</code> followed
            by a question, it'll show up here and your reply is SMSed straight back.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map(q => {
              const ageSec = q.createdAt
                ? Math.floor((Date.now() - parseServerDate(q.createdAt).getTime()) / 1000)
                : 0;
              const timeLeft = Math.max(0, 60 - ageSec);
              return (
                <li key={q.id} className="border rounded-cq-md p-3 bg-cq-wash">
                  <div className="flex justify-between items-start mb-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {q.customerName || q.customer_name || q.phone || 'Anonymous'}
                      </div>
                      <div className="text-xs text-cq-ink-3">{q.phone}</div>
                    </div>
                    <div className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${
                      timeLeft > 30
                        ? 'bg-cq-ready-wash text-cq-ready'
                        : timeLeft > 10
                        ? 'bg-cq-warn-wash text-cq-warn'
                        : 'bg-cq-alert-wash text-cq-alert'
                    }`}>
                      {timeLeft > 0 ? `${timeLeft}s left` : 'timing out…'}
                    </div>
                  </div>
                  <div className="mb-3 p-2 bg-cq-milk rounded border italic">
                    "{q.question}"
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyDrafts[q.id] || ''}
                      onChange={(e) => setReplyDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && sendReply(q)}
                      placeholder="Type reply…"
                      className="flex-1 px-2 py-1 border rounded text-sm min-w-0"
                      disabled={sending[q.id]}
                    />
                    <button
                      onClick={() => sendReply(q)}
                      disabled={sending[q.id] || !(replyDrafts[q.id] || '').trim()}
                      className="px-3 py-1 bg-cq-roast text-white rounded text-sm font-medium hover:bg-cq-caramel-deep disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 flex-shrink-0"
                    >
                      <Send size={14} />
                      {sending[q.id] ? '…' : 'Send'}
                    </button>
                  </div>
                  {blockSender && q.phone && (
                    <div className="mt-2 text-right">
                      <button
                        onClick={() => blockSender(q)}
                        disabled={blocking && blocking[q.id]}
                        title="Stop replying to this number (reversible in Runner › Messages › Blocked numbers)"
                        className="text-xs text-cq-ink-3 hover:text-cq-alert inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Ban size={12} />
                        {blocking && blocking[q.id] ? 'Blocking…' : 'Block sender'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-3 py-2 border-t bg-cq-wash text-xs text-cq-ink-3 flex-shrink-0">
        Replies are SMSed straight to the customer. After 60s with no reply, the
        system tells them all baristas are busy.
      </div>
    </div>
  );
}
