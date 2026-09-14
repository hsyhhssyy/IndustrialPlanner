import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const PROFILE_NAME = 'endfield-pipe-fluid-colors-v1';
const PHASE_ROLES = {
  liquid: ['body', 'skin', 'skin2', 'splash'],
  gas: ['body', 'skin'],
};
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const SOURCE_PATH_PATTERN = /^resources\/building-assets-site\/[^/]+\/buildings\/logistics\/fluid-profiles\.json$/;

const propertyName = (property) => {
  if (!ts.isPropertyAssignment(property)) return null;
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
};

const property = (object, name) => object.properties.find((candidate) => propertyName(candidate) === name);

const stringProperty = (object, name) => {
  const candidate = property(object, name);
  if (!candidate || !ts.isStringLiteral(candidate.initializer)) throw new Error(`Registry item has no string ${name}`);
  return candidate.initializer.text;
};

const stringArrayProperty = (object, name) => {
  const candidate = property(object, name);
  if (!candidate || !ts.isArrayLiteralExpression(candidate.initializer)) throw new Error(`Registry item has no array ${name}`);
  return candidate.initializer.elements.filter(ts.isStringLiteral).map((element) => element.text);
};

function validateColorBytes(value, label) {
  if (!Array.isArray(value) || value.length !== 4
    || value.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw new Error(`Invalid ${label}`);
  }
}

/** 校验独立美术配色表，并提取 Registry 实际需要的无损显示色。 */
export function normalizeFluidProfiles(source) {
  if (source?.schemaVersion !== 1 || source.profile !== PROFILE_NAME || typeof source.fluidProfiles !== 'object'
    || source.fluidProfiles === null || !Array.isArray(source.itemIds)) {
    throw new Error('Unsupported fluid profile source');
  }
  const ids = Object.keys(source.fluidProfiles);
  if (source.profileCount !== ids.length || new Set(source.itemIds).size !== source.itemIds.length
    || ids.length !== source.itemIds.length || ids.some((id) => !source.itemIds.includes(id))) {
    throw new Error('Fluid profile item set differs');
  }
  const phaseCounts = { liquid: 0, gas: 0 };
  const profiles = new Map();
  for (const id of ids) {
    const profile = source.fluidProfiles[id];
    const roles = PHASE_ROLES[profile?.phase];
    if (profile?.id !== id || !roles) throw new Error(`Invalid fluid profile identity/phase: ${id}`);
    if (!profile.colors || Object.keys(profile.colors).length !== roles.length
      || Object.keys(profile.colors).some((role) => !roles.includes(role))) {
      throw new Error(`Invalid fluid color roles: ${id}`);
    }
    const colors = {};
    for (const role of roles) {
      const color = profile.colors[role];
      validateColorBytes(color?.rgba8, `${id}.${role}.rgba8`);
      validateColorBytes(color?.displayRgba8, `${id}.${role}.displayRgba8`);
      if (!HEX_COLOR_PATTERN.test(color?.hex)) throw new Error(`Invalid fluid color hex: ${id}.${role}`);
      const displayHex = `#${color.displayRgba8.slice(0, 3).map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
      if (displayHex !== color.hex) throw new Error(`Fluid display color differs from hex: ${id}.${role}`);
      colors[role] = color.hex;
    }
    phaseCounts[profile.phase] += 1;
    profiles.set(id, { phase: profile.phase, colors });
  }
  if (source.phaseCounts?.liquid !== phaseCounts.liquid || source.phaseCounts?.gas !== phaseCounts.gas) {
    throw new Error('Fluid profile phase counts differ');
  }
  return profiles;
}

function itemDefinitionArray(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'ITEM_DEFINITIONS'
        && declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer)) return declaration.initializer;
    }
  }
  throw new Error('ITEM_DEFINITIONS array not found');
}

function fluidColorSourceInitializer(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'ITEM_FLUID_COLOR_SOURCE_PATH'
        && declaration.initializer && ts.isStringLiteral(declaration.initializer)) return declaration.initializer;
    }
  }
  throw new Error('ITEM_FLUID_COLOR_SOURCE_PATH not found');
}

/** 只替换现有 ItemDefinition.fluidColors 初始化值；物品集合或相态不同则拒绝生成。 */
export function updateRegistryFluidColorsSource(registrySource, profileSource, profileSourcePath) {
  if (!SOURCE_PATH_PATTERN.test(profileSourcePath)) throw new Error('Invalid fluid profile source path');
  const profiles = normalizeFluidProfiles(profileSource);
  const sourceFile = ts.createSourceFile('item-definition.ts', registrySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length) throw new Error('Registry item definition cannot be parsed');
  const fluidItems = new Map();
  for (const element of itemDefinitionArray(sourceFile).elements) {
    if (!ts.isObjectLiteralExpression(element)) throw new Error('Registry item definition is not an object');
    const id = stringProperty(element, 'id');
    const tags = stringArrayProperty(element, 'tags');
    const phases = Object.keys(PHASE_ROLES).filter((phase) => tags.includes(phase));
    if (!phases.length) continue;
    if (phases.length !== 1 || fluidItems.has(id)) throw new Error(`Invalid Registry fluid identity/phase: ${id}`);
    fluidItems.set(id, { object: element, phase: phases[0] });
  }
  if (fluidItems.size !== profiles.size || [...fluidItems.keys()].some((id) => !profiles.has(id))) {
    throw new Error('Registry fluid item set differs from source');
  }
  const sourceInitializer = fluidColorSourceInitializer(sourceFile);
  const replacements = [{ start: sourceInitializer.getStart(sourceFile), end: sourceInitializer.getEnd(),
    initializer: `"${profileSourcePath}"` }];
  for (const [id, item] of fluidItems) {
    const profile = profiles.get(id);
    if (item.phase !== profile.phase) throw new Error(`Registry fluid phase differs: ${id}`);
    const colors = property(item.object, 'fluidColors');
    if (!colors || !ts.isObjectLiteralExpression(colors.initializer)) throw new Error(`Registry fluidColors missing: ${id}`);
    const initializer = `{ ${PHASE_ROLES[profile.phase].map((role) => `${role}: "${profile.colors[role]}"`).join(', ')} }`;
    replacements.push({ start: colors.initializer.getStart(sourceFile), end: colors.initializer.getEnd(), initializer });
  }
  let output = registrySource;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.initializer}${output.slice(replacement.end)}`;
  }
  return { source: output, profileCount: profiles.size,
    phaseCounts: Object.fromEntries(Object.keys(PHASE_ROLES).map((phase) => [phase, [...profiles.values()].filter((item) => item.phase === phase).length])) };
}

export async function stageRegistryFluidColors({ profileFile, profileSourcePath, registryFile, outputFile }) {
  const profileSource = JSON.parse(await readFile(profileFile, 'utf8'));
  const registrySource = await readFile(registryFile, 'utf8');
  const result = updateRegistryFluidColorsSource(registrySource, profileSource, profileSourcePath);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, result.source);
  return { profileCount: result.profileCount, phaseCounts: result.phaseCounts,
    sourceSha256: createHash('sha256').update(registrySource).digest('hex') };
}

export async function verifyRegistryFluidColors({ profileFile, profileSourcePath, registryFile }) {
  const profileSource = JSON.parse(await readFile(profileFile, 'utf8'));
  const registrySource = await readFile(registryFile, 'utf8');
  const result = updateRegistryFluidColorsSource(registrySource, profileSource, profileSourcePath);
  if (result.source !== registrySource) throw new Error('Staged Registry fluid colors differ from source');
  return { profileCount: result.profileCount, phaseCounts: result.phaseCounts };
}
