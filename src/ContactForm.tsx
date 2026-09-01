import { useState, type FormEvent } from 'react';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type Status = { state: 'idle' } | { state: 'sending' } | { state: 'ok' } | { state: 'error'; message: string };

// Shared across the user's sites — gogenops.com/api/contact holds the Gmail
// credentials, so this posts there cross-origin instead of this project
// owning its own mail-sending function. See gogenops's
// api/_lib/allowedOrigins.ts for the origin allowlist that authorizes this.
const CONTACT_ENDPOINT = 'https://gogenops.com/api/contact';

export default function ContactForm() {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot — never shown to real visitors
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus({ state: 'sending' });
    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, company, pageUrl: window.location.href }),
      });
      const data: { ok: boolean; error?: string } = await res.json();
      if (res.ok && data.ok) {
        setStatus({ state: 'ok' });
        window.gtag?.('event', 'contact_submit', { source: 'notesmith' });
        setName('');
        setEmail('');
        setMessage('');
      } else {
        setStatus({ state: 'error', message: data.error || 'Something went wrong — please try again.' });
      }
    } catch {
      setStatus({ state: 'error', message: 'Could not reach the server — please try again later.' });
    }
  }

  return (
    <div className="settings-contact">
      <button type="button" className="link contact-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {expanded ? 'Hide contact form' : 'Contact me'}
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="contact-fields">
          <div className="setting">
            <label htmlFor="contact-name">Name</label>
            <input
              id="contact-name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="setting">
            <label htmlFor="contact-email">Email</label>
            <input
              id="contact-email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="setting">
            <label htmlFor="contact-message">Message</label>
            <textarea
              id="contact-message"
              required
              maxLength={5000}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          {/* Honeypot — off-screen, never seen or filled by a real visitor. */}
          <div className="contact-honeypot" aria-hidden="true">
            <label htmlFor="contact-company">Company</label>
            <input
              id="contact-company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <button type="submit" className="primary" disabled={status.state === 'sending'}>
            {status.state === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <p role="status" aria-live="polite" className={`contact-status ${status.state === 'ok' ? 'ok' : status.state === 'error' ? 'error' : ''}`}>
            {status.state === 'ok' && "Message sent — thanks, I'll get back to you soon."}
            {status.state === 'error' && status.message}
          </p>
        </form>
      )}
    </div>
  );
}
