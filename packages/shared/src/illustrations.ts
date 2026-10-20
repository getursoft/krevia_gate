/**
 * Flat residential-towers illustration for welcome banners (web and mobile render the same SVG).
 * Original artwork in the brand palette; no photographs or third-party imagery.
 */
export const TOWERS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
<path d="M0 150 C 60 128, 120 136, 180 146 S 280 160, 320 140 V180 H0 Z" fill="#49994E" opacity=".35"/>
<rect x="150" y="30" width="62" height="130" rx="3" fill="#E7EFEA"/><rect x="150" y="30" width="62" height="10" fill="#C9D9D0"/>
<g fill="#9DB8AA">${Array.from({ length: 9 }, (_, r) => [0, 1, 2, 3].map((c) => `<rect x="${157 + c * 13}" y="${46 + r * 12}" width="8" height="7" rx="1"/>`).join('')).join('')}</g>
<rect x="218" y="60" width="48" height="100" rx="3" fill="#F3F7F4"/><rect x="218" y="60" width="48" height="8" fill="#D4E2DA"/>
<g fill="#B3C9BD">${Array.from({ length: 7 }, (_, r) => [0, 1, 2].map((c) => `<rect x="${225 + c * 13}" y="${74 + r * 12}" width="8" height="7" rx="1"/>`).join('')).join('')}</g>
<rect x="104" y="78" width="40" height="82" rx="3" fill="#DCE8E1"/>
<g fill="#A9C2B5">${Array.from({ length: 5 }, (_, r) => [0, 1].map((c) => `<rect x="${111 + c * 15}" y="${90 + r * 13}" width="9" height="7" rx="1"/>`).join('')).join('')}</g>
<g fill="#2F7A44"><circle cx="96" cy="148" r="14"/><circle cx="276" cy="146" r="16"/><circle cx="300" cy="150" r="12"/><circle cx="140" cy="154" r="10"/></g>
<g fill="#49994E"><circle cx="84" cy="152" r="10"/><circle cx="288" cy="154" r="10"/><circle cx="208" cy="158" r="9"/></g>
<path d="M0 166 C 80 150, 200 156, 320 162 V180 H0 Z" fill="#074331"/>
</svg>`;
