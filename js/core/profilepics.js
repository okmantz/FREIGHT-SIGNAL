// Profile pictures (v18): six chess pieces to pick from. The default (id '') is still the first letter of the person's name or e-mail.
// Pure data: no DOM. `ring` is the neon colour each piece was drawn with; `src` is a 512 px picture (shown at up to ~100 px, so it stays sharp on high-DPI screens).
export const PIECES = [
  { id: 'king', label: 'King', ring: '#3df07a', src: 'assets/chess/king.webp' },
  { id: 'queen', label: 'Queen', ring: '#ff3fd0', src: 'assets/chess/queen.webp' },
  { id: 'rook', label: 'Rook', ring: '#58c8ff', src: 'assets/chess/rook.webp' },
  { id: 'bishop', label: 'Bishop', ring: '#a45bff', src: 'assets/chess/bishop.webp' },
  { id: 'knight', label: 'Knight', ring: '#ff8a2b', src: 'assets/chess/knight.webp' },
  { id: 'pawn', label: 'Pawn', ring: '#3d8bff', src: 'assets/chess/pawn.webp' },
];

/** The piece for a saved id, or null (unknown / empty id = use the initial letter). */
export const picById = (id) => PIECES.find(p => p.id === id) || null;

/** Normalise whatever is stored in the profile: only a known piece id survives. */
export const cleanPic = (id) => (picById(id) ? String(id) : '');
