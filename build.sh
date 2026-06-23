#!/usr/bin/env bash
set -e

echo ">>> Installing system dependencies for canvas..."
apt-get update -y
apt-get install -y \
  build-essential \
  python3 \
  pkg-config \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  uuid-dev

echo ">>> Installing npm packages..."
npm install

echo ">>> Rebuilding canvas from source..."
npm rebuild canvas --build-from-source

echo ">>> Build complete."
