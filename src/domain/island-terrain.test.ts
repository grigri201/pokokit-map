import { describe, expect, it } from 'vitest';

import {
  getReferenceIslandCellColor,
  getReferenceIslandMacroCellColor,
  referenceIslandMacroGrid,
  referenceIslandSubdivisions,
  referenceIslandUnifiedLandColor,
  sampleReferenceIslandTerrainColorsFromImageData,
} from './island-terrain';

describe('reference island terrain colors', () => {
  it('keeps blue water and replaces non-blue terrain with the selected land color', () => {
    expect(getReferenceIslandMacroCellColor({ x: 0, y: 0 })).toBe('#3587d7');
    expect(getReferenceIslandMacroCellColor({ x: 22, y: 22 })).toBe('#3086d8');
    expect(getReferenceIslandMacroCellColor({ x: 2, y: 4 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandMacroCellColor({ x: 11, y: 11 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandCellColor({ x: 2 * referenceIslandSubdivisions, y: 4 * referenceIslandSubdivisions })).toBe(referenceIslandUnifiedLandColor);
  });

  it('renders the reference map with only blue water colors and the unified land color', () => {
    const colors = new Set<string>();
    for (let y = 0; y < referenceIslandMacroGrid.height; y += 1) {
      for (let x = 0; x < referenceIslandMacroGrid.width; x += 1) {
        colors.add(getReferenceIslandMacroCellColor({ x, y }));
      }
    }

    const nonLandColors = [...colors].filter(color => color !== referenceIslandUnifiedLandColor);
    expect(nonLandColors.length).toBeGreaterThan(0);
    expect(nonLandColors.every(isBlueTerrainColor)).toBe(true);
  });

  it('flattens the selected center area to the unified land color', () => {
    expect(getReferenceIslandMacroCellColor({ x: 6, y: 2 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandMacroCellColor({ x: 18, y: 2 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandMacroCellColor({ x: 6, y: 19 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandMacroCellColor({ x: 18, y: 19 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandMacroCellColor({ x: 10, y: 13 })).toBe(referenceIslandUnifiedLandColor);
    expect(getReferenceIslandMacroCellColor({ x: 17, y: 1 })).toBe('#349ccb');
  });

  it('samples uploaded image colors into the 23 by 23 terrain grid', () => {
    const imageData = createImageDataFixture('#112233');
    paintImageDataCell(imageData, 22, 22, '#aabbcc');

    const terrainColors = sampleReferenceIslandTerrainColorsFromImageData(imageData);

    expect(terrainColors).toHaveLength(referenceIslandMacroGrid.height);
    expect(terrainColors[0]).toHaveLength(referenceIslandMacroGrid.width);
    expect(terrainColors[0]?.[0]).toBe('#112233');
    expect(terrainColors[22]?.[22]).toBe('#aabbcc');
    expect(getReferenceIslandMacroCellColor({ x: 22, y: 22 }, terrainColors)).toBe('#aabbcc');
    expect(getReferenceIslandCellColor({
      x: 22 * referenceIslandSubdivisions,
      y: 22 * referenceIslandSubdivisions,
    }, terrainColors)).toBe('#aabbcc');
  });
});

function createImageDataFixture(hexColor: string) {
  const data = new Uint8ClampedArray(referenceIslandMacroGrid.width * referenceIslandMacroGrid.height * 4);
  const imageData = { data, width: referenceIslandMacroGrid.width, height: referenceIslandMacroGrid.height };
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      paintImageDataCell(imageData, x, y, hexColor);
    }
  }
  return imageData;
}

function paintImageDataCell(imageData: { data: Uint8ClampedArray; width: number }, x: number, y: number, hexColor: string): void {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!match) {
    throw new Error(`Invalid test color: ${hexColor}`);
  }
  const value = Number.parseInt(match[1]!, 16);
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = (value >> 16) & 255;
  imageData.data[offset + 1] = (value >> 8) & 255;
  imageData.data[offset + 2] = value & 255;
  imageData.data[offset + 3] = 255;
}

function isBlueTerrainColor(hexColor: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!match) {
    return false;
  }

  const value = Number.parseInt(match[1]!, 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) {
    return false;
  }

  let hue = 0;
  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }
  hue = hue < 0 ? hue + 360 : hue;

  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return saturation >= 0.32 && hue >= 180 && hue <= 260;
}
