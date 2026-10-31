import { readFileSync, writeFileSync } from 'node:fs';

// Extract from the committed design/runtime owners; never from environment files.
const design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
function normalizeHex(value) {
  const hex = value.toUpperCase();
  return hex.length === 4 ? '#' + [...hex.slice(1)].map(character => character.repeat(2)).join('') : hex;
}
const colors = Object.fromEntries([...css.matchAll(/--color-([a-z-]+):\s*(#[a-f0-9]+);/gi)].map(match => [match[1], normalizeHex(match[2])]));
const variable = name => `var(--color-${name}, ${colors[name]})`;
function ramp(hex) {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const [r, g, b] = rgb;
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
  const labB = .0259040371 * l + .7827717662 * m - .808675766 * s;
  const chroma = Math.sqrt(a * a + labB * labB);
  const hue = (Math.atan2(labB, a) * 180 / Math.PI + 360) % 360;
  return [15, 25, 35, 45, 55, 65, 80, 95].map(lightness => `oklch(${lightness}% ${chroma.toFixed(4)} ${hue.toFixed(2)})`);
}
const controlFocus = `:focus-visible{outline:3px solid ${variable('focus')};outline-offset:3px}`;
const components = [
  { name: 'Primary button', kind: 'button', refersTo: 'button', description: 'The main permitted action for a task.', html: '<button class="ds-button">Save changes</button>', css: `.ds-button{font:600 14px "DM Sans",sans-serif;min-height:44px;padding:10px 16px;border:1px solid ${variable('primary')};border-radius:8px;background:${variable('primary')};color:${variable('surface')};cursor:pointer}.ds-button:hover{background:${variable('primary-hover')}}.ds-button${controlFocus}.ds-button:active{background:${variable('ink')}}` },
  { name: 'Secondary button', kind: 'button', refersTo: 'button', description: 'A quiet supporting action.', html: '<button class="ds-button-secondary">Cancel</button>', css: `.ds-button-secondary{font:600 14px "DM Sans",sans-serif;min-height:44px;padding:10px 16px;border:1px solid ${variable('border')};border-radius:8px;background:${variable('surface')};color:${variable('ink')};cursor:pointer}.ds-button-secondary:hover{background:${variable('subtle')};border-color:${variable('primary')}}.ds-button-secondary${controlFocus}` },
  { name: 'Ghost button', kind: 'button', description: 'A low-emphasis utility action.', html: '<button class="ds-button-ghost">Sign out</button>', css: `.ds-button-ghost{font:600 14px "DM Sans",sans-serif;min-height:44px;padding:10px 16px;border:1px solid transparent;border-radius:8px;background:transparent;color:${variable('secondary')};cursor:pointer}.ds-button-ghost:hover{background:${variable('subtle')};color:${variable('primary')}}.ds-button-ghost${controlFocus}` },
  { name: 'Text field', kind: 'input', refersTo: 'input', description: 'Labelled fields with a visible control boundary.', html: '<label class="ds-field">Email address<input type="email" autocomplete="email" /></label>', css: `.ds-field{display:grid;gap:7px;font:500 14px "DM Sans",sans-serif;color:${variable('ink')}}.ds-field input{height:46px;padding:10px 13px;border:1px solid ${variable('control-border')};border-radius:8px;background:${variable('surface')};color:${variable('ink')};font:400 15px "DM Sans",sans-serif}.ds-field input:hover{border-color:${variable('input-hover')}}.ds-field input:focus-visible{border-color:${variable('focus')};outline:3px solid ${variable('subtle')};outline-offset:0}` },
  { name: 'Active navigation', kind: 'nav', description: 'Quiet blue selection keeps the current destination clear.', html: '<a class="ds-nav" href="#" aria-current="page">Workspace</a>', css: `.ds-nav{display:flex;align-items:center;min-height:45px;padding:10px 13px;border-radius:8px;font:500 13px "DM Sans",sans-serif;background:${variable('subtle')};color:${variable('primary')};text-decoration:none}.ds-nav:hover{background:${variable('background')}}.ds-nav${controlFocus}` },
  { name: 'Role badge', kind: 'chip', refersTo: 'info', description: 'A readable text label for role and scope.', html: '<span class="ds-role">Administrator</span>', css: `.ds-role{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font:600 12px "DM Sans",sans-serif;background:${variable('subtle')};color:${variable('primary')}}` },
  { name: 'Working panel', kind: 'card', refersTo: 'panel', description: 'Flat working surface with a quiet boundary.', html: '<section class="ds-panel"><h3>Account details</h3><p>Information saved in your workspace.</p></section>', css: `.ds-panel{padding:30px;border:1px solid ${variable('border')};border-radius:14px;background:${variable('surface')};color:${variable('ink')}}.ds-panel h3{margin:0 0 10px;font:600 16px Manrope,sans-serif}.ds-panel p{margin:0;font:400 14px "DM Sans",sans-serif;color:${variable('secondary')}}` },
  { name: 'Password requirement', kind: 'custom', description: 'Open circle for required, check for included, with accessible state text.', html: '<div class="ds-requirement"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg><span>Uppercase letter — required</span></div><div class="ds-requirement ds-met"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg><span>Special character — included</span></div>', css: `.ds-requirement{display:flex;align-items:center;gap:6px;font:400 12px "DM Sans",sans-serif;color:${variable('secondary')};margin:7px 0}.ds-requirement svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2}.ds-met{color:${variable('success')}}` },
];
const overview = design.split('### Creative North Star\n\n')[1]?.split('\n\n## Colors')[0] || '';
const bullets = [...design.matchAll(/^- (Do |Don't )(.+)$/gm)];
const output = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), title: 'SubTrack Design System',
  extensions: {
    colorMeta: Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, { role: key.startsWith('primary') ? 'primary' : 'neutral', displayName: key.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' '), canonical: value, tonalRamp: ramp(value) }])),
    typographyMeta: { display: { displayName: 'Manrope', purpose: 'Measured, compact headings.' }, sans: { displayName: 'DM Sans', purpose: 'Forms, table data, labels and prose.' } },
    shadows: [{ name: 'dialog', value: '0 14px 45px #192b3d2b', purpose: 'Only modal confirmation surfaces.' }],
    motion: [{ name: 'state', value: '140ms', purpose: 'Focus, hover and control-state changes; removed under reduced motion.' }],
    breakpoints: [{ name: 'compact-desktop', value: '1050px' }, { name: 'navigation-row', value: '800px' }, { name: 'single-column-auth', value: '680px' }, { name: 'stacked-records', value: '600px' }],
  },
  components,
  narrative: { northStar: overview.split('\n\n')[0], overview, keyCharacteristics: ['One continuous agreement trail', 'Clear role and ownership', 'Flat working surfaces', 'No decorative financial data'], rules: [], dos: bullets.filter(match => match[1] === 'Do ').map(match => `Do ${match[2]}`), donts: bullets.filter(match => match[1] === "Don't ").map(match => `Don't ${match[2]}`) },
};
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(`Generated design sidecar metadata for ${Object.keys(colors).length} runtime colors and ${components.length} actual components.`);
