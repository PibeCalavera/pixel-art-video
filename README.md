# Pixel Art Web

A browser-based image and video processing tool created as a personal project to
experiment with image-processing techniques and generate visual references for
pixel art.

The main goal is not to create pixel art directly, but to transform images and
videos into simplified, stylized versions that can be used as visual references
when creating pixel art.

The application supports both still images and video, with a selection of
dithering algorithms, custom color-processing techniques, and export options.

## Features

### Image Processing

- Image resizing and target-size adjustment
- Color quantization
- Color palettes
- Multiple dithering algorithms
- Real-time preview
- PNG export
- Image processing using a Web Worker

### Video Processing

- Video loading and frame extraction
- Configurable processing frame rate (FPS)
- Frame-by-frame image processing
- Original audio preservation
- WebM preview generation
- WebM export
- Optional MP4 export using FFmpeg

Video processing reuses the image-processing pipeline, applying the selected
image-processing settings to each extracted frame.

The original audio is captured independently and combined with the processed
video during recording. The generated WebM preview includes duration metadata
correction to improve compatibility with video players.

MP4 conversion is performed during export, keeping WebM as the native preview
and recording format.

## Dithering Algorithms

The application currently includes the following dithering algorithms:

- None
- Bayer
- Floyd-Steinberg
- Atkinson
- Pair dithering
- Retro RGBK
- RGB Stripe

### Pair Dithering

**Pair dithering** is a custom algorithm designed to expand the perceived range
of a small color palette. It combines colors available in the palette to create
the perception of colors that are not directly available.

It is currently quite slow and still has room for improvement.

### Retro RGBK

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

The algorithm works independently of an external color palette and does not use
the general dithering strength or matrix-size settings.

The resulting image can be exported as a PNG with transparency preserved, making
it suitable for use as a sprite in applications such as Godot. Transparent areas
reveal the scene behind the sprite, while black pixels belonging to the figure
remain fully opaque.

The algorithm is designed to produce a distinctive, restricted-color retro
aesthetic rather than reproduce every source color exactly.

### RGB Stripe

**RGB Stripe** is a custom subpixel dithering algorithm that represents each
source pixel as a 3×3 block of RGB subpixels.

Each source pixel is expanded into nine output pixels, producing an image with
three times the original width and height.

The algorithm supports two layout orientations:

- Horizontal
- Vertical

It also allows the RGB channel order to be configured, making it possible to
change the arrangement of red, green, and blue subpixels.

RGB Stripe works independently of an external color palette. It does not use the
general dithering strength or matrix-size settings.

Fully transparent source pixels remain transparent in the output.
Non-transparent source pixels produce fully opaque subpixel blocks.

The algorithm is intended to reproduce the appearance of RGB subpixel structures
found in certain display technologies, creating a distinctive striped,
retro-inspired visual effect.

## Tech Stack

- JavaScript
- HTML
- CSS
- Canvas API
- Web Audio API
- MediaRecorder API
- Web Workers
- FFmpeg.wasm
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
├── app/          Application state and controllers
├── data/         Palettes and other data
├── processing/   Image and video processing algorithms
│   └── dithering/
├── ui/           User interface and export functionality
├── worker/       Background image processing
└── main.js       Application entry point

styles/           Application styles
index.html        Application entry point
```

## Status

This is a personal project created for learning, experimentation, and my pixel
art workflow.

The application has evolved from an image-only processing tool into a tool that
also supports video processing, audio preservation, and video export.

There are still areas that could be improved. The Pair Dithering algorithm in
particular is currently quite slow, and its optimization is not a priority at
the moment.

## Author

Created as a personal project and portfolio piece.
