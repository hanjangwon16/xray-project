# X-ray Anatomy Lab design system

## 0. Research Log

The existing product surface and the supplied dark clinical reference image are the visual contract. This update preserves the established atlas-first workspace and adds compact search, quiz, and per-system controls without introducing a second visual language.

## 1. Atmosphere & Identity

The product is a focused anatomy workstation: dark blue-black canvas, cool teal controls, restrained medical accents, and a bright rendered anatomy object as the focal point. The screen keeps the 3D model, CT, and X-ray in one viewport so the learning relationship stays visible.

## 2. Color

- Canvas: `#0a0c10`; panel: `#14171d`; atlas panel: `#121f28`.
- Borders: `#232833` and `#293e4a`; muted text: `#8a919d` / `#9eb4c0`.
- Accent: `#4a9eff`; selected/active teal: `#245951` / `#71cabe`.
- Anatomy colors are semantic: bone ivory, organs red, muscle rust, nerves amber, vessels crimson.

## 3. Typography

System sans stack with Korean fallback: `-apple-system`, `Pretendard`, `Noto Sans KR`. Headings use 17–20px semibold; controls and metadata use 10–12px; body copy uses 12px with 1.6–1.8 line height.

## 4. Spacing & Layout

The app owns the viewport (`100vh`, page overflow hidden). The atlas is a three-column workspace when a preview is open: tools, full-height 3D scene, and inline CT/X-ray preview. The case workspace keeps the selected plane in view without page scrolling; tool panels may scroll internally on narrow screens.

## 5. Components

- `top-workspaces`: atlas/case switcher with one active state.
- `atlas-tools`: system visibility, individual opacity, search, quick organs, and quiz.
- `atlas-scene`: vtk.js render surface with front/back/side/reset controls.
- `anatomy-preview`: selected structure, CT/X-ray tabs, slice/angle controls, and explicit unsupported-data state.
- `cell`, `workspace-nav`, and `presets`: case viewer primitives shared by CT and DRR.

All buttons have visible active states. Search results use the same button language and remain inside the tools panel.

## 6. Motion & Interaction

Orbit uses pointer capture and a capped pitch; Shift drag pans; wheel zooms exponentially within bounds. Rendering is updated on interaction and opacity changes. Search and quiz state changes are immediate. No decorative animation is used.

## 7. Depth & Surface

Panels use a one-pixel cool border, a small inset highlight, and low black shadow. The 3D scene remains the deepest surface with a near-black background; controls sit above it. Active controls use teal fill and border rather than glow-heavy effects.

## 8. Accessibility Constraints & Accepted Debt

Controls use native buttons, checkboxes, ranges, labels, and status regions. Search has an accessible label; selected data and unsupported areas are written as text. Accepted debt: vtk.js canvas geometry is visual and does not expose every mesh as a semantic DOM node; the search and quick-organ controls provide the keyboard-accessible route to supported study structures. This is educational software and is labelled non-diagnostic.
