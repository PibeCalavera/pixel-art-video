# Pixel Art Web

A small image-processing web app created as a personal project to experiment
with image-processing concepts and generate reference images for pixel art.

The main goal is not to create pixel art directly, but to produce simplified
images that can be used as visual references when creating pixel art.

## Features

- Image resizing
- Color quantization
- Color palettes
- Multiple dithering algorithms
- Real-time preview
- PNG export
- Image processing using a Web Worker

### Dithering Algorithms

- None
- Bayer
- Floyd-Steinberg
- Atkinson
- Pair dithering
- Retro RGBK

**Pair dithering** is a custom algorithm designed to expand the perceived range
of a small color palette. It combines colors available in the palette to create
the perception of colors that are not directly available.

It is currently quite slow and still has room for improvement.

**Retro RGBK** is a custom subpixel dithering algorithm inspired by retro
display techniques. It represents each source pixel as a 2×2 block of subpixels,
using red (R), green (G), blue (B), and black (K).

Each position in the block has a specific role:

```text
R/K  G/K
B/K  B/K
```

Each subpixel is either its assigned color or black. The algorithm selects from
a predefined set of valid configurations the one whose average color most
closely approximates the source pixel.

To compare colors, it converts sRGB channel values to linear-light RGB and
calculates the squared Euclidean distance between the source color and each
candidate configuration. This provides a consistent way to select the closest
available representation.

Not every possible combination of subpixels is allowed. The predefined
configurations enforce placement constraints designed to preserve the intended
visual structure. For example, isolated blue subpixels use the bottom-left
position, while the bottom-right blue subpixel is available for specific
combinations involving green. Both blue subpixels can be active simultaneously
when red and green are also active.

Before color matching, each non-transparent source pixel is composited over a
solid black background using its alpha value. This accounts for the effect of
partial transparency on the resulting RGB color without introducing
semi-transparent output pixels.

Fully transparent source pixels remain transparent in the output.
Non-transparent source pixels are converted into 2×2 blocks whose subpixels are
all fully opaque, including black subpixels. This preserves the distinction
between the transparent background and the solid black areas of the figure.

Each source pixel becomes a 2×2 block, so the output image has twice the
original width and height.

The resulting image can be exported as a PNG with transparency preserved, making
it suitable for use as a sprite in applications such as Godot. Transparent areas
reveal the scene behind the sprite, while black pixels belonging to the figure
remain fully opaque.

The algorithm is designed to produce a distinctive, restricted-color retro
aesthetic rather than reproduce every source color exactly.

## Tech Stack

- JavaScript
- HTML
- CSS
- Canvas API
- Web Workers
- Vite
- Vitest

## Getting Started

### Requirements

- Node.js
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

### Preview

```bash
npm run preview
```

### Tests

```bash
npm test
```

## Project Structure

```text
src/
├── app/          Application state and setup
├── data/         Palettes and other data
├── processing/   Image-processing algorithms
├── ui/           User interface
├── worker/       Background image processing
└── main.js       Application entry point

styles/           Application styles
tests/            Test suite
index.html        Application entry point
```

## Status

This is a personal project created for learning, experimentation, and my pixel
art workflow.

There are still many things that could be improved. The pair dithering algorithm
in particular is currently quite slow. For now, further development of that
algorithm is not a priority.

## Author

Created as a personal project and portfolio piece.
