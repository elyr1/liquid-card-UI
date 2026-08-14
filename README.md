# Liquid Card Lab

A small React experiment exploring liquid-style transitions between draggable interface elements.

Drag the cards around the canvas. When they get close, their surfaces stretch and merge into a single shape.

## How it works

Each card is represented as a rounded-box signed distance field. The fields are blended together, sampled on a grid, and converted into an SVG outline using marching squares.

The visible card content sits above that generated surface, so it remains normal HTML while the shape behind it handles the liquid effect.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal.

## Controls

* Drag either card to move it
* **Blend** adjusts how strongly nearby shapes merge
* **Detail** adjusts the resolution of the generated outline
* **Remix** moves the cards into a new arrangement
* **Reset** restores the initial scene

## Project structure

* `app/page.tsx` — scene, controls, and drag interaction
* `app/liquid-engine.ts` — distance fields and contour generation
* `app/globals.css` — layout and visual styling