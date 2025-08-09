console.clear();

// Global variables
let fontsLoaded = false;
let parentNodes: BaseNode[] = []; // Store the parent nodes globally

// Show UI
figma.showUI(__html__, { width: 400, height: 280 });

figma.on('selectionchange', () => {
  if (figma.currentPage.selection.length > 0) {
    figma.ui.postMessage({ type: 'selection-exists' });
  } else {
    figma.ui.postMessage({ type: 'no-selection' });
  }
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'check-selection') {
    if (figma.currentPage.selection.length > 0) {
      figma.ui.postMessage({ type: 'selection-exists' });
    }
    return;
  }
  if (msg.type === 'get-values') {
    const { parentLayerName } = msg;
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      sendError("Select a frame to begin.");
      return;
    }

    parentNodes = []; // Clear previous data

    // Loop through all selected nodes
    for (const rootNode of selection) {
      // If the selected node is already a swatch block, add it directly
      if (rootNode.name === parentLayerName) {
        parentNodes.push(rootNode);
      }
    
      // If the node has children, search inside it as usual
      if ('findAll' in rootNode) {
        const foundNodes = rootNode.findAll((node: BaseNode) => node.name === parentLayerName);
        parentNodes.push(...foundNodes);
      }
    }
    
    // If still no swatch blocks found, show an error
    if (parentNodes.length === 0) {
      sendError("No swatch blocks found. Select a valid frame or swatch block.");
    }

    // Log and send the count of parent nodes to the UI
    // console.log(`Found ${parentNodes.length} swatch blocks within the selected node.`);
    figma.ui.postMessage({ type: 'objects-found', message: parentNodes.length });
  }

  if (msg.type === 'write-data') {
    const { colourLayerName, hexLayerName, rgbLayerName, hsbLayerName, hslLayerName, hctLayerName } = msg;

    if (parentNodes.length === 0) {
      sendError("No swatch blocks were loaded. Please click 'Load layers' first.");
      return;
    }

    for (const parentLayer of parentNodes) {
      const colorLayer = findNodeByName(colourLayerName, parentLayer);

      if (!colorLayer || !('fills' in colorLayer)) {
        sendError(`Color layer "${colourLayerName}" not found in parent layer "${parentLayer.name}".`);
        continue;
      }

      if (colorLayer.fills === figma.mixed || !Array.isArray(colorLayer.fills)) {
        sendError(`Fills for color layer "${colorLayer.name}" are mixed or unavailable.`);
        continue;
      }

      const color = colorLayer.fills[0].color;
      const rgb = rgbOut(color.r, color.g, color.b);
      const hex = rgbToHex(color.r, color.g, color.b);
      const hsb = rgbToHsb(color.r, color.g, color.b);
      const hsl = rgbToHsl(color.r, color.g, color.b);
      const hct = rgbToHct(color.r, color.g, color.b);

      // Store the values specific to this swatch block
      const values = {
        [hexLayerName]: hex,
        [rgbLayerName]: rgb,
        [hsbLayerName]: hsb,
        [hslLayerName]: hsl,
        [hctLayerName]: hct
      };

      // Update only this parent swatch block
      await updateAllTextLayers([parentLayer], values);
    }

    figma.ui.postMessage({ type: 'run-success', message: "Swatches updated successfully!", disableWrite: true });
  }
};

//EXTERNAL FUNCTIONS

async function updateAllTextLayers(parentNodes: BaseNode[], values: Record<string, string>): Promise<void> {
  try {
    let fontsToLoad: Set<FontName> = new Set();

    // Step 1: Collect all fonts that need to be loaded
    for (const parent of parentNodes) {
      for (const [layerType, value] of Object.entries(values)) {
        const textLayer = findNodeByName(layerType, parent);
        if (textLayer && 'fontName' in textLayer) {
          fontsToLoad.add(textLayer.fontName as FontName);
        }
      }
    }

    // Step 2: Load all fonts before updating any text
    for (const font of fontsToLoad) {
      // Checkpoint font loading
      // console.log(`Loading font: ${font.family} - ${font.style}`);
      await figma.loadFontAsync(font);
    }
    // Checkpoint: Font load check
    // console.log(`✅ All fonts loaded successfully.`);

    // Step 3: Update all text layers after loading fonts
    for (const parent of parentNodes) {
      for (const [layerType, value] of Object.entries(values)) {
        const textLayer = findNodeByName(layerType, parent);
        if (textLayer) {
          await updateTextLayer(textLayer, value, layerType);
        }
      }
    }
    // Checkpoint for writing to all layers
    // console.log(`✅ All text layers updated successfully.`);
  } catch (error) {
    console.error(`❌ Failed to update text layers:`, error);
    sendError(`❌ Failed to update text layers: ${error instanceof Error ? error.message : "Unknown error occurred."}`);
  }
}

function findNodeByName(name: string, parent: BaseNode): BaseNode | null {
  // Check if the parent node itself matches
  if (parent.name === name) {
    // logNodeDetails(parent);
    return parent;
  }

  // If the parent has children, search recursively
  if ('children' in parent) {
    for (const child of parent.children) {
      const result = findNodeByName(name, child);
      if (result) {
        return result; // Return the first matching child node found
      }
    }
  }

  return null; // Return null if no match is found
}

function logNodeDetails(node: BaseNode) {
  const nodeText = "characters" in node ? node.characters : "[Not a Text Node]";
  console.log(
    `Found node: ${node.name || "[Unnamed Node]"} | Type: ${node.type} | Text: "${nodeText}"`
  );
}

function rgbOut(r: number, g: number, b: number): string {
  return `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => {
    const hex = Math.round(c * 255).toString(16).toUpperCase();
    return hex.length === 1 ? '0' + hex : hex; // Ensure two-digit hex values
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsb(r: number, g: number, b: number): string {
  // Calculate max, min, and delta
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // Calculate Hue (h)
  let h: number;
  if (delta === 0) {
    h = 0; // No hue
  } else if (max === r) {
    h = ((g - b) / delta + (g < b ? 6 : 0)) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h *= 60; // Convert to degrees

  // Calculate Saturation (s)
  const s = max === 0 ? 0 : (delta / max) * 100;

  // Calculate Brightness (b)
  const bPercent = max * 100;

  // Format the result as a string
  const hsbString = `${Math.round(h)}, ${Math.round(s)}, ${Math.round(bPercent)}`;

  // Debug intermediate results (optional)
  //console.log("Normalized RGB:", r, g, b);
  //console.log("Max:", max, "Min:", min, "Delta:", delta);
  //console.log("HSB Values:", hsbString);

  // Return the formatted string
  return hsbString;
}

function rgbToHsl(r: number, g: number, b: number): string {
  // Calculate max, min, and delta
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // Calculate Lightness (l)
  const l = (max + min) / 2;

  // Calculate Saturation (s)
  let s: number;
  if (delta === 0) {
    s = 0; // No saturation
  } else {
    s = delta / (1 - Math.abs(2 * l - 1));
  }

  // Calculate Hue (h)
  let h: number;
  if (delta === 0) {
    h = 0; // No hue
  } else if (max === r) {
    h = ((g - b) / delta + (g < b ? 6 : 0)) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h *= 60; // Convert to degrees

  // Format the result as a string
  const hslString = `${Math.round(h)}, ${Math.round(s * 100)}, ${Math.round(l * 100)}`;

  // Debug intermediate results (optional)
  //console.log("Normalized RGB:", r, g, b);
  //console.log("Max:", max, "Min:", min, "Delta:", delta);
  //console.log("HSL Values:", hslString);

  // Return the formatted string
  return hslString;
}

import { Hct } from '@material/material-color-utilities';

function rgbToHct(r: number, g: number, b: number): string {
  try {
    // Convert normalized RGB (0-1) to 0-255
    const red = Math.round(r * 255);
    const green = Math.round(g * 255);
    const blue = Math.round(b * 255);
    // Create HCT color
    const hct = Hct.fromInt((red << 16) + (green << 8) + blue);
    // Format as "hue, chroma, tone"
    return `${Math.round(hct.hue)}, ${Math.round(hct.chroma)}, ${Math.round(hct.tone)}`;
 } catch (err) {
    return "HCT calculation error";
  }
}

async function updateTextLayer(layer: BaseNode | null, value: string, layerType: string): Promise<void> {
  if (!layer || !('characters' in layer)) {
    sendError(`${layerType} not found or cannot be updated.`);
    console.error(`Error: ${layerType} layer not found or isn't a text layer.`);
    return;
  }

  try {
    const textNode = layer as TextNode;
    const fontName = textNode.fontName as FontName;

    // Finally, set the characters
    layer.characters = value;
    //Checkpoint for each write to layer
    //console.log(`Updated ${layerType}:`, value);
  } catch (error) {
    console.error(`Failed to update ${layerType} layer:`, error);
    sendError(`Failed to update ${layerType} layer: ${error instanceof Error ? error.message : "Unknown error occurred."}`);
  }
}

function sendError(message: string): void {
  figma.ui.postMessage({ type: 'error', message });
}