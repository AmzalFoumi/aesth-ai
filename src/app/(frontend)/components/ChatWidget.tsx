'use client'

import React, { useEffect, useRef, useState } from 'react'

// Self-contained chat surface. Holds NO business logic — it only manages a
// sessionKey and POSTs to /chat. That HTTP-contract-only dependency is what lets
// it drop into any client frontend unchanged. Two visual variants share this one
// component: `full` (centered homepage stage) and `widget` (docked corner FAB).

// Mirrors the backend ChatOutput union (src/lib/ai-chat/types.ts). Kept inline so
// the widget stays HTTP-contract-only and drops into any frontend unchanged.
type ChatOutput =
  | { kind: 'plain'; spokenAnswer?: string }
  | {
      kind: 'timeline'
      spokenAnswer?: string
      title?: string
      steps: { order: number; title: string; detail: string; productRefs?: string[] }[]
    }
  | {
      kind: 'productList'
      spokenAnswer?: string
      intro?: string
      products: { name: string; brand?: string; priceRange?: string; rating?: number; url?: string; why?: string }[]
    }
  | {
      kind: 'comparison'
      spokenAnswer?: string
      items: string[]
      rows: { feature: string; values: string[] }[]
    }

type Msg = { role: 'user' | 'assistant'; text: string; output?: ChatOutput }
type Mode = 'db' | 'rag' | 'both'
type Variant = 'full' | 'widget'

const SESSION_STORAGE_KEY = 'aesth-chat-session'
const MODES: Mode[] = ['db', 'rag', 'both']

const STARTERS = [
  'Gentle cleanser for oily skin',
  'Build me a nighttime routine',
  'Vitamin C serum under 300k IDR',
]

// Deterministic gradient per product, so swatches vary but stay stable across
// renders. There are no product images in the dataset — this is a decorative tile.
function swatchStyle(seed: string): React.CSSProperties {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return {
    background: `linear-gradient(150deg,
      hsl(${h} 32% 88% / 1),
      hsl(${(h + 40) % 360} 38% 70% / 1))`,
  }
}

export const ChatWidget: React.FC<{ variant?: Variant }> = ({ variant = 'widget' }) => {
  const full = variant === 'full'
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  // A/B retrieval arm. Sent as `mode` so we can flip db vs rag vs both live.
  // Surfaced only in the widget variant — the full demo hides internals.
  const [mode, setMode] = useState<Mode>('db')
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

  const send = async (override?: string) => {
    const message = (override ?? input).trim()
    if (!message || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: message }])
    setLoading(true)
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The model always self-selects its answer shape (from OUTPUT_SHAPES); no
        // per-request override — forcing a shape overwhelmed lighter models.
        body: JSON.stringify({ sessionKey: sessionKey.current, message, mode }),
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

  const conversation = (
    <>
      {messages.map((m, i) => (
        <div key={i} className={`turn turn--${m.role}`}>
          <span className="turn__who">{m.role === 'user' ? 'You' : 'Advisor'}</span>
          <div className="bubble">
            {m.role === 'assistant' && m.output ? (
              <StructuredAnswer output={m.output} fallback={m.text} />
            ) : (
              m.text
            )}
          </div>
        </div>
      ))}
      {loading && (
        <div className="turn turn--assistant">
          <span className="turn__who">Advisor</span>
          <div className="bubble">
            <span className="typing" aria-label="Advisor is typing">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        </div>
      )}
    </>
  )

  // ---- Full-stage variant (homepage) ----
  if (full) {
    const empty = messages.length === 0 && !loading
    return (
      <div className="stage">
        <header className="stage__top">
          <div className="brand">
            <span className="brand__mark">
              aesth<span className="dot">-ai</span>
            </span>
            <span className="brand__tag">Beauty Advisor</span>
          </div>
          <div className="status">
            <span className="status__pulse" />
            Online
          </div>
        </header>

        <div className="thread" ref={scrollRef}>
          {empty && (
            <>
              <div className="intro">
                <h1>What are you looking to solve today?</h1>
                <p>Ask about routines, ingredients, or specific concerns — I&apos;ll recommend from our catalog.</p>
              </div>
              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} className="chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          {conversation}
        </div>

        <div className="composer-wrap">
          <div className="composer">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask the advisor…"
              aria-label="Message the advisor"
              disabled={loading}
            />
            <button className="composer__send" onClick={() => send()} disabled={loading} aria-label="Send message">
              ↑
            </button>
          </div>
          <div className="footnote">Recommendations drawn from our live product catalog.</div>
        </div>
      </div>
    )
  }

  // ---- Corner-widget variant ----
  return (
    <div className="widget">
      {open && (
        <div className="widget__panel">
          <div className="widget__header">
            <span>Product Assistant</span>
            <button className="widget__close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="widget__messages" ref={scrollRef}>
            {messages.length === 0 && <div className="widget__hint">Ask me about our beauty products.</div>}
            {conversation}
          </div>
          <div className="widget__input-row">
            <input
              className="widget__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message…"
              disabled={loading}
            />
            <button className="widget__send" onClick={() => send()} disabled={loading}>
              Send
            </button>
          </div>
        </div>
      )}
      <button className="widget__fab" onClick={() => setOpen((o) => !o)}>
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
          {output.spokenAnswer && <div>{output.spokenAnswer}</div>}
          {output.title && <div className="shape__title">{output.title}</div>}
          <ol className="timeline">
            {[...output.steps]
              .sort((a, b) => a.order - b.order)
              .map((s, i) => (
                <li key={i} className="timeline__step">
                  <span className="timeline__step-title">{s.title}</span>
                  {s.detail && <div className="timeline__detail">{s.detail}</div>}
                  {s.productRefs && s.productRefs.length > 0 && (
                    <div className="timeline__refs">{s.productRefs.join(' · ')}</div>
                  )}
                </li>
              ))}
          </ol>
        </div>
      )
    case 'productList':
      return (
        <div>
          {output.spokenAnswer && <div>{output.spokenAnswer}</div>}
          {output.intro && <div className="shape__intro">{output.intro}</div>}
          <div className="cards">
            {output.products.map((p, i) => (
              <div key={i} className="card">
                <div className="card__swatch" style={swatchStyle(p.brand || p.name)} />
                <div className="card__body">
                  <div className="card__name">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.name}
                      </a>
                    ) : (
                      p.name
                    )}
                  </div>
                  <div className="card__meta">
                    {[
                      p.brand,
                      p.priceRange,
                      p.rating != null ? `★ ${p.rating}` : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {p.why && <div className="card__why">{p.why}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    case 'comparison':
      return (
        <div>
          {output.spokenAnswer && <div>{output.spokenAnswer}</div>}
          <div className="table-wrap">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th />
                  {output.items.map((it, i) => (
                    <th key={i}>{it}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {output.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="feature">{r.feature}</td>
                    {r.values.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    default:
      return <>{output.spokenAnswer || fallback}</>
  }
}
