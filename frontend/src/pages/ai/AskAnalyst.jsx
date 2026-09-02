import { useState, useRef, useEffect } from 'react';
import { useBrand } from '../../context/BrandContext';
import { askAnalyst } from '../../api/ai';
import PageHeader from '../../components/ui/PageHeader';
import { Send, Sparkles, User } from 'lucide-react';

const SUGGESTIONS = [
  'Which SKUs drive 80% of my net margin?',
  'Which states should I restrict to prepaid?',
  'Which campaigns should I cut this week?',
  'What is eroding my gross-to-net the most?',
];

export default function AskAnalyst() {
  const { activeBrand } = useBrand();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const send = async (question) => {
    const q = (question ?? input).trim();
    if (!q || loading || !activeBrand) return;
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    try {
      const r = await askAnalyst(activeBrand.id, q);
      const res = r.data.data;
      setMessages(prev => [...prev, {
        role: 'ai',
        text: res.answer,
        configured: res.configured,
        context: res.context_used,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: err.response?.data?.message || 'Something went wrong reaching the analyst.', error: true }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="Ask Analyst" subtitle="AI-powered answers grounded in your live business data" />

      <div className="card">
        <div className="card-body">
          <div className="chat-container">
            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="text-center py-4">
                  <div className="d-inline-flex align-items-center justify-content-center mb-3" style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--color-muted)' }}>
                    <Sparkles size={26} color="var(--color-primary)" />
                  </div>
                  <h5 style={{ color: 'var(--color-text)' }}>Ask about your business</h5>
                  <p style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>The analyst only uses your real data — no guesses.</p>
                  <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
                    {SUGGESTIONS.map((s, i) => (
                      <button key={i} className="btn btn-outline-primary btn-sm" style={{ fontSize: '0.8rem', borderRadius: '999px' }} onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`d-flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.role === 'user' ? 'var(--color-primary)' : 'var(--color-accent)' }}>
                    {m.role === 'user' ? <User size={16} color="#fff" /> : <Sparkles size={16} color="#000" />}
                  </div>
                  <div className={`chat-bubble ${m.role}`} style={m.error ? { background: 'rgba(220,38,38,.12)', color: 'var(--color-destructive)' } : {}}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    {m.configured === false && (
                      <div className="mt-2" style={{ fontSize: '0.72rem', opacity: 0.8, fontStyle: 'italic' }}>
                        (ANTHROPIC_API_KEY not set — showing raw data context only)
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="d-flex gap-2">
                  <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent)' }}>
                    <Sparkles size={16} color="#000" />
                  </div>
                  <div className="chat-bubble ai">
                    <span className="typing-dots">Analyzing your data…</span>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="chat-input-bar">
              <input
                className="form-control"
                placeholder={activeBrand ? 'Ask a question about your business…' : 'Select a brand first'}
                value={input}
                disabled={!activeBrand || loading}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
              />
              <button className="btn btn-primary d-flex align-items-center gap-1" onClick={() => send()} disabled={!activeBrand || loading || !input.trim()}>
                <Send size={16} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
