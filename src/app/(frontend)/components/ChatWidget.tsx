'use client'

import React, { useEffect, useRef, useState } from 'react'

// Minimal, self-contained chat widget. Holds NO business logic — it only manages
// a sessionKey and POSTs to /chat. That HTTP-contract-only dependency is what lets
// it drop into any client frontend unchanged.

// Mirrors the backend ChatOutput union (src/lib/ai-chat/types.ts). Kept inline so
// the widget stays HTTP-contract-only and drops into any frontend unchanged.
type ChatOutput =
  | { kind: 'plain'; spokenAnswer: string }
  | {
      kind: 'timeline'
      spokenAnswer: string
      title: string
      steps: { order: number; title: string; detail: string; productRefs?: string[] }[]
    }
  | {
      kind: 'productList'
      spokenAnswer: string
      intro?: string
      products: { name: string; brand?: string; priceRange?: string; rating?: number; url?: string; why?: string }[]
    }
  | {
      kind: 'comparison'
      spokenAnswer: string
      items: string[]
      rows: { feature: string; values: string[] }[]
    }

type Msg = { role: 'user' | 'assistant'; text: string; output?: ChatOutput }
type Mode = 'db' | 'rag' | 'both'
// 'auto' = let the model choose (no shapes override sent). Others force that shape (+plain).
type ShapeChoice = 'auto' | 'timeline' | 'productList' | 'comparison' | 'plain'

const SESSION_STORAGE_KEY = 'aesth-chat-session'
const MODES: Mode[] = ['db', 'rag', 'both']
const SHAPES: ShapeChoice[] = ['auto', 'timeline', 'productList', 'comparison', 'plain']

export const ChatWidget: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  // A/B retrieval arm. Sent as `mode` so we can flip db vs rag vs both live.
  const [mode, setMode] = useState<Mode>('db')
  // Which answer shape to force. 'auto' sends no override (model self-selects).
  const [shape, setShape] = useState<ShapeChoice>('auto')
  const sessionKey = useRef<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let key = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!key) {
      key = crypto.randomUUID()
      localStorage.setItem(SESSION_STORAGE_KEY, key)
    }
    sessionKey.current = key
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, loading])

  const send = async () => {
    const message = input.trim()
    if (!message || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: message }])
    setLoading(true)
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Only send `shapes` when forcing a shape; 'auto' lets the model self-select.
        body: JSON.stringify({
          sessionKey: sessionKey.current,
          message,
          mode,
          ...(shape === 'auto' ? {} : { shapes: shape }),
        }),
      })
      const data = await res.json()
      const text = data.text ?? data.error ?? 'Something went wrong.'
      const output = (data.output ?? undefined) as ChatOutput | undefined
      setMessages((m) => [...m, { role: 'assistant', text, output }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Network error. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') send()
  }

  return (
    <div style={styles.root}>
      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <span>Product Assistant</span>
            <button style={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div style={styles.modeRow}>
            <span style={styles.modeLabel}>Retrieval</span>
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{ ...styles.modeBtn, ...(mode === m ? styles.modeBtnActive : {}) }}
              >
                {m}
              </button>
            ))}
          </div>
          <div style={styles.modeRow}>
            <span style={styles.modeLabel}>Shape</span>
            {SHAPES.map((s) => (
              <button
                key={s}
                onClick={() => setShape(s)}
                style={{ ...styles.modeBtn, ...(shape === s ? styles.modeBtnActive : {}) }}
              >
                {s}
              </button>
            ))}
          </div>
          <div ref={scrollRef} style={styles.messages}>
            {messages.length === 0 && (
              <div style={styles.hint}>Ask me about our beauty products.</div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  ...styles.bubble,
                  ...(m.role === 'user' ? styles.user : styles.assistant),
                }}
              >
                {m.role === 'assistant' && m.output ? (
                  <StructuredAnswer output={m.output} fallback={m.text} />
                ) : (
                  m.text
                )}
              </div>
            ))}
            {loading && <div style={{ ...styles.bubble, ...styles.assistant }}>…</div>}
          </div>
          <div style={styles.inputRow}>
            <input
              style={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message…"
              disabled={loading}
            />
            <button style={styles.send} onClick={send} disabled={loading}>
              Send
            </button>
          </div>
        </div>
      )}
      <button style={styles.fab} onClick={() => setOpen((o) => !o)}>
        {open ? 'Close' : 'Chat'}
      </button>
    </div>
  )
}

// Renders the model's self-selected shape as a real component. Falls back to plain
// text for `plain`/unknown kinds so text-only turns keep working.
const StructuredAnswer: React.FC<{ output: ChatOutput; fallback: string }> = ({ output, fallback }) => {
  switch (output.kind) {
    case 'timeline':
      return (
        <div>
          {output.title && <div style={styles.shapeTitle}>{output.title}</div>}
          <ol style={styles.timeline}>
            {[...output.steps]
              .sort((a, b) => a.order - b.order)
              .map((s, i) => (
                <li key={i} style={styles.step}>
                  <span style={styles.stepTitle}>{s.title}</span>
                  {s.detail && <div style={styles.stepDetail}>{s.detail}</div>}
                  {s.productRefs && s.productRefs.length > 0 && (
                    <div style={styles.refs}>{s.productRefs.join(' · ')}</div>
                  )}
                </li>
              ))}
          </ol>
        </div>
      )
    case 'productList':
      return (
        <div>
          {output.intro && <div style={styles.stepDetail}>{output.intro}</div>}
          <div style={styles.cards}>
            {output.products.map((p, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.cardName}>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer" style={styles.cardLink}>
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </div>
                <div style={styles.cardMeta}>
                  {[p.brand, p.priceRange, p.rating != null ? `★ ${p.rating}` : undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {p.why && <div style={styles.stepDetail}>{p.why}</div>}
              </div>
            ))}
          </div>
        </div>
      )
    case 'comparison':
      return (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}></th>
                {output.items.map((it, i) => (
                  <th key={i} style={styles.th}>
                    {it}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {output.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...styles.td, ...styles.tdFeature }}>{r.feature}</td>
                  {r.values.map((v, j) => (
                    <td key={j} style={styles.td}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return <>{output.spokenAnswer || fallback}</>
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'fixed', right: 20, bottom: 20, zIndex: 1000, fontFamily: 'system-ui, sans-serif' },
  fab: {
    background: '#111', color: '#fff', border: 'none', borderRadius: 24, padding: '10px 20px',
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: 14,
  },
  panel: {
    width: 340, height: 460, marginBottom: 12, background: '#fff', color: '#111',
    borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.25)', display: 'flex',
    flexDirection: 'column', overflow: 'hidden', border: '1px solid #eee',
  },
  header: {
    padding: '12px 14px', background: '#111', color: '#fff', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 14,
  },
  close: { background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 },
  modeRow: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
    borderBottom: '1px solid #eee', background: '#fafafa',
  },
  modeLabel: { fontSize: 11, color: '#888', marginRight: 2 },
  modeBtn: {
    background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: 6,
    padding: '3px 8px', fontSize: 11, cursor: 'pointer', textTransform: 'uppercase',
  },
  modeBtnActive: { background: '#111', color: '#fff', borderColor: '#111' },
  messages: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  hint: { color: '#888', fontSize: 13, textAlign: 'center', marginTop: 20 },
  bubble: { padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', maxWidth: '85%' },
  user: { alignSelf: 'flex-end', background: '#111', color: '#fff' },
  assistant: { alignSelf: 'flex-start', background: '#f2f2f2', color: '#111' },
  inputRow: { display: 'flex', borderTop: '1px solid #eee', padding: 8, gap: 8 },
  input: { flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: '8px 10px', fontSize: 14, outline: 'none' },
  send: { background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 },
  // --- structured-shape render styles ---
  shapeTitle: { fontWeight: 600, marginBottom: 6 },
  timeline: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 },
  step: { fontSize: 13 },
  stepTitle: { fontWeight: 600 },
  stepDetail: { color: '#444', fontSize: 13, marginTop: 2 },
  refs: { color: '#888', fontSize: 11, marginTop: 2 },
  cards: { display: 'flex', flexDirection: 'column', gap: 6 },
  card: { border: '1px solid #e5e5e5', borderRadius: 8, padding: '6px 8px', background: '#fff' },
  cardName: { fontWeight: 600, fontSize: 13 },
  cardLink: { color: '#111', textDecoration: 'underline' },
  cardMeta: { color: '#888', fontSize: 11, marginTop: 1 },
  tableWrap: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', fontSize: 12, width: '100%' },
  th: { border: '1px solid #e5e5e5', padding: '4px 6px', background: '#f7f7f7', textAlign: 'left', fontWeight: 600 },
  td: { border: '1px solid #e5e5e5', padding: '4px 6px', verticalAlign: 'top' },
  tdFeature: { fontWeight: 600, background: '#fafafa' },
}
