import { getItemDef } from '../data/items';
import { SHAPES } from '../data/shapes';

/**
 * Generates crisp, miniature industrial sci-fi top-down SVG master assets for every equipment & cargo item.
 * Strictly obeys Art Production Spec v1.0:
 * - 192x192 source pixels per logical cell
 * - 12px outer margin from logical cell bounds; zero breaks across multi-cell interiors
 * - L3 (1,0) and T4 (0,1)/(2,1) cutouts are 100% transparent
 * - Soft overhead lighting only (NO baked directional shadows; renderer adds screen-fixed bottom-right shadow)
 * - NO text, numbers, prices, or quality frames inside the asset
 * - Common vs Improved differ by added mechanical detail (fins, twin coils, reinforced armor chevrons, dual arms)
 */

const SVG_CACHE = new Map<string, string>();

function wrapSvg(width: number, height: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none">${inner}</svg>`;
}

function renderLaserSvg(improved: boolean): string {
  // 1x2: 192 x 384 (margin 12px -> active x: 12..180, y: 12..372)
  const extraParts = improved
    ? `
      <!-- Improved twin focusing coils & extended heat fins -->
      <rect x="34" y="92" width="18" height="72" rx="5" fill="#2A3A4E" stroke="#7E93AB" stroke-width="4"/>
      <rect x="140" y="92" width="18" height="72" rx="5" fill="#2A3A4E" stroke="#7E93AB" stroke-width="4"/>
      <rect x="39" y="104" width="8" height="48" rx="3" fill="#62D6DF"/>
      <rect x="145" y="104" width="8" height="48" rx="3" fill="#62D6DF"/>
      <path d="M22 288 L36 274 L36 346 L22 332 Z" fill="#44556B" stroke="#859BB3" stroke-width="3"/>
      <path d="M170 288 L156 274 L156 346 L170 332 Z" fill="#44556B" stroke="#859BB3" stroke-width="3"/>
      <rect x="64" y="216" width="64" height="14" rx="4" fill="#F6B852"/>
    `
    : `
      <rect x="74" y="220" width="44" height="10" rx="3" fill="#D49A42"/>
    `;

  const body = `
    <defs>
      <linearGradient id="steelV" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3E4D60"/>
        <stop offset="50%" stop-color="#687A90"/>
        <stop offset="100%" stop-color="#39475A"/>
      </linearGradient>
      <linearGradient id="turret" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#58697E"/>
        <stop offset="100%" stop-color="#334254"/>
      </linearGradient>
    </defs>
    <!-- Rear turret base in cell (0,1) -->
    <path d="M36 218 L54 196 L138 196 L156 218 L156 350 L138 368 L54 368 L36 350 Z"
          fill="url(#turret)" stroke="#92A6BC" stroke-width="5"/>
    <!-- Recessed panel & rear heat vents -->
    <rect x="52" y="246" width="88" height="96" rx="10" fill="#253344" stroke="#56677D" stroke-width="4"/>
    <line x1="66" y1="270" x2="126" y2="270" stroke="#75889E" stroke-width="7" stroke-linecap="round"/>
    <line x1="66" y1="294" x2="126" y2="294" stroke="#75889E" stroke-width="7" stroke-linecap="round"/>
    <line x1="66" y1="318" x2="126" y2="318" stroke="#75889E" stroke-width="7" stroke-linecap="round"/>
    <!-- Central rotary ring -->
    <circle cx="96" cy="212" r="38" fill="#2C3B4E" stroke="#8095AD" stroke-width="5"/>
    <!-- Long dual-rail barrel spanning up into cell (0,0) -->
    <rect x="62" y="34" width="68" height="184" rx="10" fill="url(#steelV)" stroke="#8FA4BB" stroke-width="5"/>
    <!-- Barrel inner cooling channel -->
    <rect x="82" y="42" width="28" height="148" rx="6" fill="#182534"/>
    <rect x="89" y="50" width="14" height="128" rx="4" fill="#62D6DF"/>
    <!-- Muzzle emitter crown -->
    <path d="M56 38 L66 16 L126 16 L136 38 L126 56 L66 56 Z" fill="#46576B" stroke="#A6B9CE" stroke-width="5"/>
    <rect x="76" y="18" width="40" height="14" rx="4" fill="#62D6DF"/>
    <!-- Mechanical wear chips on edges -->
    <path d="M40 232 L48 236 L42 246" stroke="#B7C6D6" stroke-width="3" stroke-linecap="round"/>
    <path d="M148 332 L154 340" stroke="#B7C6D6" stroke-width="3" stroke-linecap="round"/>
    <!-- Corner bolts -->
    <circle cx="52" cy="352" r="5" fill="#9BB0C6"/>
    <circle cx="140" cy="352" r="5" fill="#9BB0C6"/>
    ${extraParts}
  `;
  return wrapSvg(192, 384, body);
}

function renderBatterySvg(improved: boolean): string {
  // 1x1: 192 x 192 (symmetrical terminals on all 4 orthogonal edges)
  const core = improved
    ? `
      <!-- Improved dual high-density cells + amber busbar -->
      <rect x="44" y="48" width="44" height="96" rx="14" fill="#182738" stroke="#62D6DF" stroke-width="5"/>
      <rect x="104" y="48" width="44" height="96" rx="14" fill="#182738" stroke="#62D6DF" stroke-width="5"/>
      <rect x="54" y="60" width="24" height="72" rx="8" fill="#62D6DF"/>
      <rect x="114" y="60" width="24" height="72" rx="8" fill="#62D6DF"/>
      <rect x="40" y="88" width="112" height="16" rx="5" fill="#F6B852" stroke="#1E2B3B" stroke-width="3"/>
    `
    : `
      <!-- Single central cylindrical cell -->
      <circle cx="96" cy="96" r="44" fill="#182738" stroke="#7A90A8" stroke-width="5"/>
      <circle cx="96" cy="96" r="28" fill="#254C5C" stroke="#62D6DF" stroke-width="5"/>
      <circle cx="96" cy="96" r="14" fill="#62D6DF"/>
      <line x1="96" y1="54" x2="96" y2="68" stroke="#F6B852" stroke-width="6" stroke-linecap="round"/>
      <line x1="96" y1="124" x2="96" y2="138" stroke="#F6B852" stroke-width="6" stroke-linecap="round"/>
    `;

  const body = `
    <defs>
      <linearGradient id="batShell" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#5B6D82"/>
        <stop offset="100%" stop-color="#344356"/>
      </linearGradient>
    </defs>
    <!-- 4 symmetrical orthogonal connector lugs (explicitly implies 4-way adjacency) -->
    <rect x="74" y="14" width="44" height="18" rx="4" fill="#62D6DF" stroke="#1D2A3A" stroke-width="4"/>
    <rect x="74" y="160" width="44" height="18" rx="4" fill="#62D6DF" stroke="#1D2A3A" stroke-width="4"/>
    <rect x="14" y="74" width="18" height="44" rx="4" fill="#62D6DF" stroke="#1D2A3A" stroke-width="4"/>
    <rect x="160" y="74" width="18" height="44" rx="4" fill="#62D6DF" stroke="#1D2A3A" stroke-width="4"/>
    <!-- Chamfered compact square housing -->
    <path d="M46 28 L146 28 L164 46 L164 146 L146 164 L46 164 L28 146 L28 46 Z"
          fill="url(#batShell)" stroke="#98AEC5" stroke-width="5"/>
    <!-- Inner recessed tray -->
    <rect x="38" y="38" width="116" height="116" rx="12" fill="#233244" stroke="#4D5F75" stroke-width="4"/>
    ${core}
    <!-- Corner fasteners -->
    <circle cx="46" cy="46" r="4" fill="#A5B9CE"/>
    <circle cx="146" cy="46" r="4" fill="#A5B9CE"/>
    <circle cx="46" cy="146" r="4" fill="#A5B9CE"/>
    <circle cx="146" cy="146" r="4" fill="#A5B9CE"/>
  `;
  return wrapSvg(192, 192, body);
}

function renderShieldSvg(improved: boolean): string {
  // 1x2: 192 x 384 (distinct broad layered armor plates + central field emitter)
  const extra = improved
    ? `
      <!-- Improved layered chevron armor & dual auxiliary emitters -->
      <path d="M36 92 L96 66 L156 92 L156 122 L96 96 L36 122 Z" fill="#5D738C" stroke="#A6BCD3" stroke-width="4"/>
      <path d="M36 292 L96 318 L156 292 L156 262 L96 288 L36 262 Z" fill="#5D738C" stroke="#A6BCD3" stroke-width="4"/>
      <circle cx="96" cy="110" r="10" fill="#62D6DF"/>
      <circle cx="96" cy="274" r="10" fill="#62D6DF"/>
      <rect x="26" y="168" width="16" height="48" rx="4" fill="#F6B852"/>
      <rect x="150" y="168" width="16" height="48" rx="4" fill="#F6B852"/>
    `
    : `
      <rect x="52" y="84" width="88" height="24" rx="6" fill="#46586D" stroke="#859BB2" stroke-width="4"/>
      <rect x="52" y="276" width="88" height="24" rx="6" fill="#46586D" stroke="#859BB2" stroke-width="4"/>
    `;

  const body = `
    <defs>
      <linearGradient id="shieldPlate" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3E5065"/>
        <stop offset="50%" stop-color="#6B8098"/>
        <stop offset="100%" stop-color="#3A4C61"/>
      </linearGradient>
    </defs>
    <!-- Broad curved/chamfered shield armor silhouette -->
    <path d="M44 18 L148 18 L174 52 L174 332 L148 366 L44 366 L18 332 L18 52 Z"
          fill="url(#shieldPlate)" stroke="#9DB3C9" stroke-width="5"/>
    <!-- Inner armor channel -->
    <path d="M52 38 L140 38 L156 60 L156 324 L140 346 L52 346 L36 324 L36 60 Z"
          fill="#253447" stroke="#53667D" stroke-width="4"/>
    ${extra}
    <!-- Central field generator dome -->
    <circle cx="96" cy="192" r="46" fill="#1D2D3F" stroke="#8AA2BB" stroke-width="5"/>
    <circle cx="96" cy="192" r="30" fill="#244B5B" stroke="#62D6DF" stroke-width="5"/>
    <polygon points="96,170 115,182 115,202 96,214 77,202 77,182" fill="#62D6DF"/>
    <!-- Heavy armor clamps -->
    <rect x="20" y="132" width="14" height="26" rx="3" fill="#8FA5BC"/>
    <rect x="158" y="132" width="14" height="26" rx="3" fill="#8FA5BC"/>
    <rect x="20" y="226" width="14" height="26" rx="3" fill="#8FA5BC"/>
    <rect x="158" y="226" width="14" height="26" rx="3" fill="#8FA5BC"/>
  `;
  return wrapSvg(192, 384, body);
}

function renderDroneSvg(improved: boolean): string {
  // L3: 384 x 384, occupied cells: (0,0), (0,1), (1,1). Cell (1,0) [x:192..384, y:0..192] MUST BE 100% TRANSPARENT!
  const extra = improved
    ? `
      <!-- Improved dual welding piston & amber work lamp -->
      <rect x="128" y="80" width="24" height="96" rx="6" fill="#4F6379" stroke="#9EB4CB" stroke-width="4"/>
      <circle cx="140" cy="70" r="12" fill="#F6B852"/>
      <rect x="218" y="220" width="96" height="22" rx="6" fill="#4F6379" stroke="#9EB4CB" stroke-width="4"/>
      <circle cx="328" cy="231" r="10" fill="#62D6DF"/>
    `
    : '';

  const body = `
    <defs>
      <linearGradient id="droneHull" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#607388"/>
        <stop offset="100%" stop-color="#37475A"/>
      </linearGradient>
    </defs>
    <!-- Upper mechanical tool arm in cell (0,0) connecting cleanly into (0,1) -->
    <path d="M52 216 L52 46 L76 22 L116 22 L140 46 L140 216 Z"
          fill="#3E4F63" stroke="#8CA2B9" stroke-width="5"/>
    <!-- Hydraulic arm cylinder & welding torch head in (0,0) -->
    <rect x="74" y="64" width="44" height="120" rx="8" fill="#233243" stroke="#64788F" stroke-width="4"/>
    <rect x="86" y="76" width="20" height="94" rx="4" fill="#9BB0C6"/>
    <path d="M62 30 L84 30 L84 56 L62 56 Z" fill="#F6B852"/>
    <path d="M108 30 L130 30 L130 56 L108 56 Z" fill="#F6B852"/>
    <circle cx="96" cy="40" r="10" fill="#62D6DF"/>

    <!-- Right articulated manipulator arm in cell (1,1) connecting cleanly into (0,1) -->
    <path d="M168 242 L338 242 L362 266 L362 310 L338 334 L168 334 Z"
          fill="#3E4F63" stroke="#8CA2B9" stroke-width="5"/>
    <rect x="202" y="264" width="122" height="48" rx="8" fill="#233243" stroke="#64788F" stroke-width="4"/>
    <rect x="216" y="278" width="90" height="20" rx="4" fill="#9BB0C6"/>
    <!-- Claw pincers at right end of (1,1) -->
    <path d="M336 250 L364 258 L354 276 L332 272 Z" fill="#F6B852"/>
    <path d="M336 326 L364 318 L354 300 L332 304 Z" fill="#F6B852"/>

    <!-- Main repair drone chassis at corner cell (0,1) -->
    <path d="M34 214 L56 196 L156 196 L180 220 L180 342 L156 366 L56 366 L34 344 Z"
          fill="url(#droneHull)" stroke="#A5BAD0" stroke-width="5"/>
    <!-- Maintenance cross emblem (readable in grayscale!) -->
    <circle cx="106" cy="282" r="46" fill="#203042" stroke="#758BA3" stroke-width="5"/>
    <rect x="94" y="254" width="24" height="56" rx="4" fill="#F6B852"/>
    <rect x="78" y="270" width="56" height="24" rx="4" fill="#F6B852"/>
    <circle cx="106" cy="282" r="7" fill="#1C293A"/>
    ${extra}
  `;
  return wrapSvg(384, 384, body);
}

function renderDataBoxSvg(): string {
  // 1x1: 192 x 192
  const body = `
    <defs>
      <linearGradient id="boxGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#8A6E4B"/>
        <stop offset="100%" stop-color="#59452E"/>
      </linearGradient>
    </defs>
    <!-- Protective corner bumpers -->
    <rect x="20" y="20" width="152" height="152" rx="20" fill="#2B3645" stroke="#7E8FA3" stroke-width="5"/>
    <!-- Sealed black-box casing -->
    <rect x="34" y="34" width="124" height="124" rx="12" fill="url(#boxGrad)" stroke="#C7A57A" stroke-width="4"/>
    <!-- Ribbed memory core -->
    <rect x="52" y="54" width="88" height="54" rx="6" fill="#24303F" stroke="#7B8EA3" stroke-width="3"/>
    <line x1="64" y1="68" x2="128" y2="68" stroke="#A6B7C9" stroke-width="6" stroke-linecap="round"/>
    <line x1="64" y1="84" x2="112" y2="84" stroke="#62D6DF" stroke-width="6" stroke-linecap="round"/>
    <line x1="64" y1="98" x2="122" y2="98" stroke="#A6B7C9" stroke-width="5" stroke-linecap="round"/>
    <!-- Latch & status LED -->
    <rect x="56" y="122" width="52" height="20" rx="5" fill="#3B495C" stroke="#8FA2B8" stroke-width="3"/>
    <circle cx="128" cy="132" r="9" fill="#F6B852"/>
  `;
  return wrapSvg(192, 192, body);
}

function renderAlloyBarSvg(): string {
  // 1x2: 192 x 384 — strapped industrial metal ingots (clearly distinct from shield plate)
  const body = `
    <defs>
      <linearGradient id="ingot" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6A7685"/>
        <stop offset="45%" stop-color="#A8B5C4"/>
        <stop offset="100%" stop-color="#5B6775"/>
      </linearGradient>
    </defs>
    <!-- Three parallel chamfered ingots -->
    <rect x="30" y="22" width="38" height="340" rx="8" fill="url(#ingot)" stroke="#C5D0DC" stroke-width="4"/>
    <rect x="77" y="18" width="38" height="348" rx="8" fill="url(#ingot)" stroke="#D0DAE5" stroke-width="4"/>
    <rect x="124" y="22" width="38" height="340" rx="8" fill="url(#ingot)" stroke="#C5D0DC" stroke-width="4"/>
    <!-- Heavy cargo tie-down straps -->
    <rect x="22" y="96" width="148" height="34" rx="6" fill="#2A3544" stroke="#F6B852" stroke-width="4"/>
    <rect x="22" y="254" width="148" height="34" rx="6" fill="#2A3544" stroke="#F6B852" stroke-width="4"/>
    <!-- Strap buckles -->
    <rect x="78" y="102" width="36" height="22" rx="4" fill="#D59E45"/>
    <rect x="78" y="260" width="36" height="22" rx="4" fill="#D59E45"/>
  `;
  return wrapSvg(192, 384, body);
}

function renderCoolantTankSvg(): string {
  // 1x3: 192 x 576
  const body = `
    <defs>
      <linearGradient id="tankCyl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#364C59"/>
        <stop offset="45%" stop-color="#5E8091"/>
        <stop offset="100%" stop-color="#2D404D"/>
      </linearGradient>
    </defs>
    <!-- Protective frame rails -->
    <rect x="34" y="20" width="124" height="536" rx="54" fill="url(#tankCyl)" stroke="#9BB6C5" stroke-width="5"/>
    <!-- End pressure caps -->
    <path d="M56 24 L136 24 L148 64 L44 64 Z" fill="#425366" stroke="#8FA4BA" stroke-width="4"/>
    <path d="M44 512 L148 512 L136 552 L56 552 Z" fill="#425366" stroke="#8FA4BA" stroke-width="4"/>
    <!-- Structural tank rings -->
    <rect x="26" y="148" width="140" height="24" rx="6" fill="#2B3A4C" stroke="#899FB5" stroke-width="4"/>
    <rect x="26" y="276" width="140" height="24" rx="6" fill="#2B3A4C" stroke="#899FB5" stroke-width="4"/>
    <rect x="26" y="404" width="140" height="24" rx="6" fill="#2B3A4C" stroke="#899FB5" stroke-width="4"/>
    <!-- Sight gauge window -->
    <rect x="82" y="186" width="28" height="204" rx="10" fill="#182734" stroke="#7E97AA" stroke-width="4"/>
    <rect x="89" y="204" width="14" height="172" rx="6" fill="#62D6DF"/>
    <!-- Valve wheel at top -->
    <circle cx="96" cy="102" r="22" fill="#273546" stroke="#F6B852" stroke-width="5"/>
    <circle cx="96" cy="102" r="7" fill="#F6B852"/>
  `;
  return wrapSvg(192, 576, body);
}

function renderOldEngineSvg(): string {
  // 2x2: 384 x 384
  const body = `
    <defs>
      <linearGradient id="engBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#69625C"/>
        <stop offset="100%" stop-color="#3E3A38"/>
      </linearGradient>
    </defs>
    <!-- Heavy square engine frame -->
    <path d="M52 24 L332 24 L360 52 L360 332 L332 360 L52 360 L24 332 L24 52 Z"
          fill="url(#engBody)" stroke="#A89F96" stroke-width="6"/>
    <!-- Outer manifold housings -->
    <rect x="44" y="48" width="296" height="84" rx="14" fill="#465261" stroke="#8B99AA" stroke-width="5"/>
    <rect x="44" y="252" width="296" height="84" rx="14" fill="#465261" stroke="#8B99AA" stroke-width="5"/>
    <!-- Central turbine rotor & exhaust housing -->
    <circle cx="192" cy="192" r="102" fill="#26313E" stroke="#99A7B8" stroke-width="6"/>
    <circle cx="192" cy="192" r="72" fill="#1A232E" stroke="#C98A42" stroke-width="5"/>
    <!-- Turbine blades -->
    <path d="M192 126 L206 178 L258 192 L206 206 L192 258 L178 206 L126 192 L178 178 Z" fill="#6F7D8E"/>
    <circle cx="192" cy="192" r="24" fill="#D49746" stroke="#1C2530" stroke-width="4"/>
    <!-- Intake cooling slots -->
    <line x1="76" y1="78" x2="148" y2="78" stroke="#B7C2CE" stroke-width="8" stroke-linecap="round"/>
    <line x1="236" y1="78" x2="308" y2="78" stroke="#B7C2CE" stroke-width="8" stroke-linecap="round"/>
    <line x1="76" y1="306" x2="148" y2="306" stroke="#B7C2CE" stroke-width="8" stroke-linecap="round"/>
    <line x1="236" y1="306" x2="308" y2="306" stroke="#B7C2CE" stroke-width="8" stroke-linecap="round"/>
    <!-- Wear bolts -->
    <circle cx="52" cy="52" r="7" fill="#C4B9AD"/>
    <circle cx="332" cy="52" r="7" fill="#C4B9AD"/>
    <circle cx="52" cy="332" r="7" fill="#C4B9AD"/>
    <circle cx="332" cy="332" r="7" fill="#C4B9AD"/>
  `;
  return wrapSvg(384, 384, body);
}

function renderFoldingAntennaSvg(): string {
  // L3: 384 x 384, cells (0,0),(0,1),(1,1). Cell (1,0) MUST BE 100% TRANSPARENT!
  const body = `
    <!-- Vertical dish spine in (0,0)-(0,1) -->
    <rect x="64" y="24" width="64" height="316" rx="14" fill="#4D5F73" stroke="#9AB0C7" stroke-width="5"/>
    <!-- Folded parabolic dish wings in (0,0) -->
    <path d="M26 36 C26 24 166 24 166 36 L154 152 L38 152 Z" fill="#6B7E93" stroke="#BCCDE0" stroke-width="5"/>
    <line x1="96" y1="36" x2="96" y2="146" stroke="#2D3C4E" stroke-width="6"/>
    <line x1="48" y1="90" x2="144" y2="90" stroke="#2D3C4E" stroke-width="5"/>
    <circle cx="96" cy="90" r="14" fill="#F6B852" stroke="#1E2A3A" stroke-width="4"/>

    <!-- Horizontal folded truss & transceiver pod in (1,1) -->
    <rect x="116" y="252" width="244" height="72" rx="14" fill="#46576B" stroke="#9AB0C7" stroke-width="5"/>
    <line x1="176" y1="262" x2="220" y2="314" stroke="#859BB2" stroke-width="6"/>
    <line x1="220" y1="262" x2="264" y2="314" stroke="#859BB2" stroke-width="6"/>
    <rect x="276" y="242" width="76" height="92" rx="12" fill="#324254" stroke="#B7C8DA" stroke-width="5"/>
    <circle cx="314" cy="288" r="16" fill="#62D6DF"/>

    <!-- Heavy rotary hinge at corner (0,1) -->
    <circle cx="96" cy="288" r="56" fill="#2E3E51" stroke="#A6BBD0" stroke-width="6"/>
    <circle cx="96" cy="288" r="24" fill="#D9A148" stroke="#1D2938" stroke-width="4"/>
  `;
  return wrapSvg(384, 384, body);
}

function renderAncientNavigatorSvg(): string {
  // T4: 576 x 384, cells (0,0),(1,0),(2,0),(1,1). Cells (0,1) & (2,1) MUST BE 100% TRANSPARENT!
  const body = `
    <defs>
      <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#C9A259"/>
        <stop offset="50%" stop-color="#8D6E3B"/>
        <stop offset="100%" stop-color="#5E4826"/>
      </linearGradient>
    </defs>
    <!-- Lower gyroscopic column in cell (1,1) [x: 192..384, y: 192..384] -->
    <path d="M226 168 L350 168 L350 338 L322 366 L254 366 L226 338 Z"
          fill="#354354" stroke="#C9A259" stroke-width="6"/>
    <rect x="252" y="218" width="72" height="118" rx="12" fill="#1E2B3A" stroke="#8A7042" stroke-width="4"/>
    <circle cx="288" cy="278" r="22" fill="#244B5A" stroke="#62D6DF" stroke-width="4"/>
    <circle cx="288" cy="278" r="9" fill="#F6B852"/>

    <!-- Top horizontal T-bar across (0,0),(1,0),(2,0) [x: 16..560, y: 16..176] -->
    <path d="M46 26 L530 26 L556 54 L556 138 L530 166 L46 166 L20 138 L20 54 Z"
          fill="#2D3B4D" stroke="url(#brass)" stroke-width="7"/>
    <!-- Left & right vernier star-scale wings in (0,0) and (2,0) -->
    <rect x="44" y="54" width="144" height="84" rx="10" fill="#1E2A38" stroke="#A6874D" stroke-width="4"/>
    <line x1="64" y1="96" x2="168" y2="96" stroke="#C9A259" stroke-width="5"/>
    <line x1="88" y1="74" x2="88" y2="118" stroke="#62D6DF" stroke-width="4"/>
    <line x1="124" y1="70" x2="124" y2="122" stroke="#F6B852" stroke-width="4"/>
    <line x1="154" y1="78" x2="154" y2="114" stroke="#62D6DF" stroke-width="4"/>

    <rect x="388" y="54" width="144" height="84" rx="10" fill="#1E2A38" stroke="#A6874D" stroke-width="4"/>
    <line x1="408" y1="96" x2="512" y2="96" stroke="#C9A259" stroke-width="5"/>
    <line x1="422" y1="78" x2="422" y2="114" stroke="#62D6DF" stroke-width="4"/>
    <line x1="452" y1="70" x2="452" y2="122" stroke="#F6B852" stroke-width="4"/>
    <line x1="488" y1="74" x2="488" y2="118" stroke="#62D6DF" stroke-width="4"/>

    <!-- Center unique concentric ring astrolabe core in (1,0) -->
    <circle cx="288" cy="96" r="70" fill="#172332" stroke="url(#brass)" stroke-width="7"/>
    <circle cx="288" cy="96" r="50" fill="none" stroke="#62D6DF" stroke-width="5" stroke-dasharray="18 8"/>
    <circle cx="288" cy="96" r="30" fill="#1F4252" stroke="#F6B852" stroke-width="5"/>
    <polygon points="288,72 296,88 312,96 296,104 288,120 280,104 264,96 280,88" fill="#F6B852"/>
  `;
  return wrapSvg(576, 384, body);
}

export function getItemSvgMarkup(defId: string): string {
  const cached = SVG_CACHE.get(defId);
  if (cached) return cached;

  let svg: string;
  switch (defId) {
    case 'equipment.laser.common':
      svg = renderLaserSvg(false);
      break;
    case 'equipment.laser.improved':
      svg = renderLaserSvg(true);
      break;
    case 'equipment.battery.common':
      svg = renderBatterySvg(false);
      break;
    case 'equipment.battery.improved':
      svg = renderBatterySvg(true);
      break;
    case 'equipment.shield.common':
      svg = renderShieldSvg(false);
      break;
    case 'equipment.shield.improved':
      svg = renderShieldSvg(true);
      break;
    case 'equipment.drone.common':
      svg = renderDroneSvg(false);
      break;
    case 'equipment.drone.improved':
      svg = renderDroneSvg(true);
      break;
    case 'cargo.data_box':
      svg = renderDataBoxSvg();
      break;
    case 'cargo.alloy_bar':
      svg = renderAlloyBarSvg();
      break;
    case 'cargo.coolant_tank':
      svg = renderCoolantTankSvg();
      break;
    case 'cargo.old_engine':
      svg = renderOldEngineSvg();
      break;
    case 'cargo.folding_antenna':
      svg = renderFoldingAntennaSvg();
      break;
    case 'cargo.ancient_navigator':
      svg = renderAncientNavigatorSvg();
      break;
    default: {
      const def = getItemDef(defId);
      const shape = SHAPES[def.shapeId];
      svg = wrapSvg(
        shape.sourcePixelWidth,
        shape.sourcePixelHeight,
        `<rect x="12" y="12" width="${shape.sourcePixelWidth - 24}" height="${shape.sourcePixelHeight - 24}" rx="12" fill="#566477"/>`
      );
    }
  }

  SVG_CACHE.set(defId, svg);
  return svg;
}

const DATA_URL_CACHE = new Map<string, string>();

export function getItemImageUrl(defId: string): string {
  const cached = DATA_URL_CACHE.get(defId);
  if (cached) return cached;
  const svg = getItemSvgMarkup(defId);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  DATA_URL_CACHE.set(defId, url);
  return url;
}
