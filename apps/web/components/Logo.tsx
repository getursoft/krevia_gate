import { BRAND } from '@krevia/shared';

/** Krevia mark: the official "K" sheltering a home, with the green swoosh (design/krevia-mark.png). */
export function KreviaMark({ size = 40, title, inverse = false }: { size?: number; title?: string; inverse?: boolean }) {
  return (
    <img
      src={inverse ? '/krevia-mark-white.png' : '/krevia-mark.png'}
      width={size}
      height={size}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', flex: 'none' }}
    />
  );
}

/** Mark + wordmark + optional tagline lockup. `inverse` is for dark green backgrounds. */
export function Logo({ size = 40, tagline = true, inverse = false }: { size?: number; tagline?: boolean; inverse?: boolean }) {
  return (
    <span className={inverse ? 'logo logo-inverse' : 'logo'}>
      <KreviaMark size={size} inverse={inverse} />
      <span className="logo-text">
        <span className="logo-word" style={{ fontSize: size * 0.62 }}>
          {BRAND.name}
        </span>
        {tagline && <span className="logo-tagline">{BRAND.tagline}</span>}
      </span>
    </span>
  );
}
