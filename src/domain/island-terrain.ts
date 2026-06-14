export interface TerrainCell {
  x: number;
  y: number;
}

export type IslandTerrainColors = string[][];

export const referenceIslandMacroGrid = {
  width: 23,
  height: 23,
} as const;

export const referenceIslandSubdivisions = 16;

export const referenceIslandGrid = {
  width: referenceIslandMacroGrid.width * referenceIslandSubdivisions,
  height: referenceIslandMacroGrid.height * referenceIslandSubdivisions,
} as const;

export const referenceIslandWaterColor = '#2d8be8';
export const referenceIslandUnifiedLandColor = '#d8c49b';
const referenceIslandUnifiedInteriorBounds = {
  minX: 6,
  maxX: 18,
  minY: 2,
  maxY: 19,
} as const;

export const referenceIslandTerrainColors = [
  ['#3587d7', '#2d84d7', '#2d84d8', '#2f88d9', '#2c85d7', '#2fa2da', '#359dd0', '#349dd2', '#349ed0', '#339ed0', '#2f9fd4', '#35a1d6', '#349ed1', '#349ed1', '#349ed0', '#349ed1', '#369ed1', '#30a2d9', '#2c85d6', '#2d85d6', '#2c83d6', '#3087db', '#3286d7'],
  ['#2e84d7', '#2c84d5', '#2a84d3', '#31a4dc', '#309dd2', '#349cca', '#dbc59a', '#dac79b', '#dac59a', '#dbc497', '#b8b69f', '#615e5c', '#756459', '#4d3e3d', '#b29f80', '#dbc59b', '#dcc69c', '#349ccb', '#309cd1', '#2e9fd8', '#2984d2', '#2f86d9', '#2d84d8'],
  ['#2d83d7', '#2884d4', '#2b9fd6', '#3a9bcb', '#d9c398', '#d8c499', '#d9c599', '#91b399', '#91b293', '#e6b174', '#73b1a1', '#666867', '#646564', '#5d5b5b', '#666565', '#676564', '#4c3e3c', '#3a95bf', '#d8c49a', '#3796c1', '#2c9dd4', '#2c88d9', '#2c83d8'],
  ['#2f88da', '#31a3db', '#3a9ecd', '#e4cfa3', '#decb9c', '#7bb8a4', '#b3b993', '#79b9a9', '#70afa0', '#cfb887', '#97b79a', '#6a6c6b', '#686867', '#49a9b2', '#8ba2a3', '#5c5d5d', '#686967', '#448d2b', '#95856b', '#dfc99f', '#379ccd', '#33a7de', '#2f89d9'],
  ['#2c85d7', '#389ccc', '#d8c49b', '#e1c99c', '#93b499', '#a9b792', '#afb58d', '#76b4a4', '#73b5a4', '#74b4a3', '#76b3a0', '#676968', '#5c5b5b', '#41aab1', '#76a2a8', '#789ea2', '#5b5a59', '#40a324', '#448739', '#d8c597', '#b5b7a0', '#34a0d6', '#2e86d8'],
  ['#2fa1d8', '#399ccb', '#d9c497', '#97b89b', '#76b4a3', '#cbb585', '#95b596', '#75b5a4', '#73b5a5', '#8cbbb3', '#c9b384', '#686966', '#e7b277', '#42aaaf', '#3ab3b8', '#58a9ae', '#48a7ad', '#43a125', '#42a221', '#68a434', '#b9a580', '#399dce', '#30a0da'],
  ['#389ece', '#dbc69c', '#d7c599', '#76b9a7', '#74b5a5', '#76b5a2', '#74b6a7', '#74b5a5', '#72b6a5', '#72b5a5', '#76b49f', '#43a325', '#449f20', '#428c2e', '#419b2d', '#44a124', '#43a126', '#3f9d28', '#69ab39', '#6aa534', '#b8a483', '#979689', '#35a0d0'],
  ['#359fd1', '#bfb89c', '#95b396', '#78b8a8', '#8ebdb5', '#74b5a5', '#74b5a5', '#79b1a3', '#73b5a6', '#90b499', '#a6ab82', '#9ad67c', '#41a222', '#40a21f', '#40a31f', '#41a421', '#3e8825', '#66a833', '#70a737', '#6ba534', '#9aa74b', '#e0ca9d', '#3e9cc6'],
  ['#389dcf', '#dac59b', '#72b2a3', '#93b99e', '#8eb599', '#91b599', '#abb690', '#afb58e', '#75b4a2', '#bfc379', '#c0c276', '#acca76', '#a0c971', '#9ad176', '#3f8723', '#40a320', '#95ad4c', '#6ca435', '#c2b15f', '#92ac48', '#6da637', '#dfca9e', '#3e9cc6'],
  ['#33a0d2', '#bcb69e', '#70b3a2', '#77b8a6', '#73b5a4', '#74b5a3', '#75b4a4', '#74b5a4', '#a9ca7b', '#afc778', '#aec775', '#9cd47b', '#abc976', '#bfc176', '#c6bf75', '#44a020', '#8fa946', '#9fab4d', '#90ac48', '#6da333', '#42a020', '#706e67', '#369fcf'],
  ['#379dcc', '#d9c398', '#71b1a0', '#6eaf9e', '#73b3a1', '#c8c978', '#75b2a0', '#74b3a0', '#d2bb76', '#c0c174', '#d79f66', '#c1b36f', '#d4b571', '#99ce76', '#accf5c', '#cac267', '#c4b05e', '#93aa48', '#6aa330', '#c8c166', '#6ba434', '#ddc99b', '#3d9bc6'],
  ['#3ba1d3', '#c8b480', '#c5b37e', '#ccb687', '#c7b280', '#d3cd77', '#d0ce79', '#edb97a', '#b9cd7f', '#b5d893', '#bbcf9a', '#e9bad1', '#adb97d', '#9dd47b', '#b3d55e', '#c6cd64', '#b6d45e', '#b7d460', '#b3d55e', '#b3d35d', '#b1d25d', '#a4b4a7', '#30a5db'],
  ['#379ecf', '#5b5e5f', '#bea47d', '#cbbc7d', '#c9bf78', '#cdc874', '#d0cc84', '#dad2a4', '#bfdeb2', '#bbcbcb', '#c6dfbe', '#cbd3a0', '#adc675', '#adc977', '#add05b', '#cac363', '#cfc068', '#d7bd6b', '#bbc960', '#afcd5b', '#abce57', '#dfc99d', '#3c9bc5'],
  ['#369ece', '#585f61', '#c6b578', '#cbbb7e', '#c3b07b', '#cec875', '#d0cb82', '#d7d19d', '#badbac', '#bacdca', '#b5c7df', '#86b5d9', '#83b39f', '#97d07a', '#9cd076', '#bfc961', '#beca62', '#cbc466', '#b2cf5c', '#a7cb58', '#b8c85f', '#e0ca9a', '#3d9cc5'],
  ['#389ed0', '#585f60', '#bfa67c', '#d2cd79', '#cec876', '#cec973', '#ceca77', '#ccba95', '#d5d3a1', '#d8d6ab', '#afc5df', '#b4d467', '#aecf5d', '#7ca4a0', '#afd060', '#a6c755', '#cbc465', '#c4c765', '#b0d05b', '#7fa19e', '#afcc5c', '#e0cb9d', '#3d9bc5'],
  ['#369ed0', '#5a5f5f', '#cdc776', '#d3ce79', '#cec975', '#cfca75', '#c1a97e', '#cdc07e', '#d1c892', '#d5d29c', '#d2bb95', '#b5d65e', '#b0d05b', '#b3ce60', '#b1d15c', '#b2d15d', '#b3d05d', '#b2d25c', '#a3c956', '#b0cf5f', '#afcf5b', '#c3ba9c', '#359fcd'],
  ['#399ecf', '#baac8d', '#dbc495', '#cca556', '#c7a153', '#c7a253', '#d0c977', '#c5b27c', '#c4af80', '#d0cb81', '#c9a96a', '#b5d55e', '#e8b572', '#bfca61', '#d0c268', '#bfcb61', '#bbcc61', '#b2d15d', '#bbcb62', '#ddbb6f', '#d9c496', '#c6bfa0', '#399dcc'],
  ['#2fa1d7', '#4599c0', '#978e77', '#caa558', '#c7a154', '#c8a053', '#d0ca74', '#cfc876', '#cec974', '#cdc875', '#c6a052', '#c4cc63', '#e7b471', '#b4cd5d', '#b1d05b', '#dcbc6e', '#b3cf5d', '#b0d15b', '#beca61', '#c0c763', '#d8c496', '#409bc8', '#2da2d8'],
  ['#2b86d7', '#379dcd', '#7a786e', '#beae8c', '#c6a156', '#cfc874', '#cfc976', '#c5a154', '#ccc076', '#c8b878', '#cfbf67', '#d2c667', '#bcc860', '#a7b756', '#b0d15f', '#c0c963', '#b2cf5e', '#c1c864', '#d6bd6c', '#dac495', '#b8b39b', '#33a1d3', '#2a87d6'],
  ['#2c84d6', '#2e9fd5', '#4098c2', '#dfc99c', '#77776a', '#c6b87e', '#c3b07b', '#c6ad7c', '#c4b07d', '#c5a054', '#c59f50', '#b5d25e', '#b0cd5b', '#6d9cc1', '#7da8ab', '#b0cf5d', '#afd05e', '#a8b057', '#dbc396', '#d9c498', '#3d96bf', '#31a3d9', '#2c86d5'],
  ['#2b83d7', '#2883d2', '#2d9cd5', '#3e9dca', '#769397', '#77827e', '#dac497', '#c4a054', '#c39f55', '#c49e50', '#c29e50', '#b2d25c', '#accd58', '#adcb5f', '#adcd5d', '#cdbf67', '#d8c594', '#dac395', '#beb699', '#3c98c3', '#2e9dd3', '#2d86d6', '#2b83d7'],
  ['#3086db', '#2f86da', '#2c86d7', '#33a7df', '#2fa4da', '#3aa0d0', '#a89d83', '#848072', '#bcac8d', '#a1967e', '#9d947c', '#e2cf9e', '#dec999', '#dfcb9a', '#dfcb99', '#dfcb9d', '#e1cb9f', '#4199c4', '#37a1d4', '#31a3da', '#2b87d6', '#318add', '#3086dc'],
  ['#3486d9', '#2d84d8', '#2b83d6', '#2d8ad8', '#2a87d6', '#2ea1d9', '#3e99c7', '#3e99c5', '#459dc6', '#3f9bc4', '#409ac3', '#46a0ca', '#459cc5', '#469dc5', '#469cc6', '#469ec7', '#469dc6', '#2ea2d7', '#2988d6', '#2a86d5', '#2c83d4', '#3087d9', '#3086d8'],
] as const;

export function getReferenceIslandCellColor(cell: TerrainCell, terrainColors?: IslandTerrainColors): string {
  return getReferenceIslandMacroCellColor({
    x: Math.floor(cell.x / referenceIslandSubdivisions),
    y: Math.floor(cell.y / referenceIslandSubdivisions),
  }, terrainColors);
}

export function getReferenceIslandMacroCellColor(cell: TerrainCell, terrainColors?: IslandTerrainColors): string {
  const importedColor = terrainColors?.[cell.y]?.[cell.x];
  if (importedColor) {
    return importedColor;
  }

  if (isReferenceIslandUnifiedInteriorCell(cell)) {
    return referenceIslandUnifiedLandColor;
  }

  const originalColor = referenceIslandTerrainColors[cell.y]?.[cell.x] ?? referenceIslandWaterColor;
  return isBlueReferenceTerrainColor(originalColor) ? originalColor : referenceIslandUnifiedLandColor;
}

export function sampleReferenceIslandTerrainColorsFromImageData(imageData: {
  data: ArrayLike<number>;
  width: number;
  height: number;
}): IslandTerrainColors {
  const colors: IslandTerrainColors = [];
  for (let y = 0; y < referenceIslandMacroGrid.height; y += 1) {
    const row: string[] = [];
    const sourceY = clampInteger(Math.floor(((y + 0.5) / referenceIslandMacroGrid.height) * imageData.height), 0, imageData.height - 1);
    for (let x = 0; x < referenceIslandMacroGrid.width; x += 1) {
      const sourceX = clampInteger(Math.floor(((x + 0.5) / referenceIslandMacroGrid.width) * imageData.width), 0, imageData.width - 1);
      const offset = (sourceY * imageData.width + sourceX) * 4;
      row.push(rgbToHex(
        imageData.data[offset] ?? 0,
        imageData.data[offset + 1] ?? 0,
        imageData.data[offset + 2] ?? 0,
        imageData.data[offset + 3] ?? 255,
      ));
    }
    colors.push(row);
  }
  return colors;
}

export function isIslandTerrainColors(value: unknown): value is IslandTerrainColors {
  return (
    Array.isArray(value) &&
    value.length === referenceIslandMacroGrid.height &&
    value.every(row => (
      Array.isArray(row) &&
      row.length === referenceIslandMacroGrid.width &&
      row.every(color => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color))
    ))
  );
}

function isReferenceIslandUnifiedInteriorCell(cell: TerrainCell): boolean {
  return (
    cell.x >= referenceIslandUnifiedInteriorBounds.minX &&
    cell.x <= referenceIslandUnifiedInteriorBounds.maxX &&
    cell.y >= referenceIslandUnifiedInteriorBounds.minY &&
    cell.y <= referenceIslandUnifiedInteriorBounds.maxY
  );
}

function rgbToHex(red: number, green: number, blue: number, alpha: number): string {
  const opacity = clampInteger(alpha, 0, 255) / 255;
  const channels = [red, green, blue].map(channel => clampInteger(Math.round(channel * opacity + 255 * (1 - opacity)), 0, 255));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function isBlueReferenceTerrainColor(hexColor: string): boolean {
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
