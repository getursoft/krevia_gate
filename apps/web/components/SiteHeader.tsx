'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="logo" aria-label="Krevia home">
          <Logo size={38} />
        </Link>
        <button
          type="button"
          className="btn btn-ghost menu-toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'x' : 'menu'} />
          <span className="sr-only">Menu</span>
        </button>
        <nav id="site-nav" className="site-nav" data-open={open} aria-label="Main">
          <a className="navlink" href="#platform" onClick={() => setOpen(false)}>Platform</a>
          <a className="navlink" href="#residents" onClick={() => setOpen(false)}>For residents</a>
          <a className="navlink" href="#societies" onClick={() => setOpen(false)}>For societies</a>
          <Link className="btn btn-ghost" href="/login">Sign in</Link>
          <Link className="btn btn-primary" href="/register">Get started</Link>
        </nav>
      </div>
    </header>
  );
}
