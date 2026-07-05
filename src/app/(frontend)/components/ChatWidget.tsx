'use client'

import React, { useEffect, useRef, useState } from 'react'

// Minimal, self-contained chat widget. Holds NO business logic — it only manages
// a sessionKey and POSTs to /chat. That HTTP-contract-only dependency is what lets
// it drop into any client frontend unchanged.

type Msg = { role: 'user' | 'assistant'; text: string }
type Mode = 'db' | 'rag' | 'both'

const SESSION_STORAGE_KEY = 'aesth-chat-session'
const MODES: Mode[] = ['db', 'rag', 'both']

export const ChatWidget: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  // A/B retrieval arm. Sent as `mode` so we can flip db vs rag vs both live.
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
        body: JSON.stringify({ sessionKey: sessionKey.current, message, mode }),
      })
      const data = await res.json()
      const text = data.text ?? data.error ?? 'Something went wrong.'
      setMessages((m) => [...m, { role: 'assistant', text }])
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
                {m.text}
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
}
