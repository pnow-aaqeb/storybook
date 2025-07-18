import { dirname, sep } from 'node:path';

import { getProjectRoot } from 'storybook/internal/common';

import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import loadConfig from 'next/dist/server/config';
import type { ImageLoaderProps } from 'next/image';
import { DefinePlugin } from 'webpack';
import type { Configuration as WebpackConfig } from 'webpack';

export interface CustomImageLoaderConfig {
  loader: 'custom';
  loaderFile: string;
}

export const getCustomLoaderConfig = (nextConfig: NextConfig): CustomImageLoaderConfig | null => {
  if (nextConfig.images?.loader === 'custom' && nextConfig.images.loaderFile) {
    return {
      loader: 'custom',
      loaderFile: nextConfig.images.loaderFile,
    };
  }
  return null;
};

export const loadCustomImageLoader = (
  loaderFile: string,
  configDir: string
): ((props: ImageLoaderProps) => string) | null => {
  try {
    const loaderPath = require.resolve(loaderFile, { paths: [configDir] });

    delete require.cache[loaderPath];

    const loaderModule = require(loaderPath);
    const loaderFunction = loaderModule.default || loaderModule;

    if (typeof loaderFunction !== 'function') {
      console.warn(`[Storybook] Custom image loader at ${loaderPath} is not a function`);
      return null;
    }

    return loaderFunction;
  } catch (error) {
    console.error('[Storybook] Failed to load custom image loader:', error);
    return null;
  }
};

export const configureRuntimeNextjsVersionResolution = (baseConfig: WebpackConfig): void => {
  baseConfig.plugins?.push(
    new DefinePlugin({
      'process.env.__NEXT_VERSION': JSON.stringify(getNextjsVersion()),
    })
  );
};

export const getNextjsVersion = (): string => require(scopedResolve('next/package.json')).version;

export const resolveNextConfig = async ({
  nextConfigPath,
}: {
  nextConfigPath?: string;
}): Promise<NextConfig> => {
  let dir: string;

  if (nextConfigPath) {
    // Resolve the full absolute path to the config file first
    const absoluteConfigPath = require('path').resolve(nextConfigPath);
    dir = dirname(absoluteConfigPath);

    console.log('🔧 resolveNextConfig - nextConfigPath:', nextConfigPath);
    console.log('🔧 resolveNextConfig - absoluteConfigPath:', absoluteConfigPath);
    console.log('🔧 resolveNextConfig - dir:', dir);
    console.log(
      '🔧 resolveNextConfig - config exists:',
      require('fs').existsSync(absoluteConfigPath)
    );
  } else {
    dir = getProjectRoot();
  }

  return loadConfig(PHASE_DEVELOPMENT_SERVER, dir, undefined);
};

export function setAlias(baseConfig: WebpackConfig, name: string, alias: string) {
  baseConfig.resolve ??= {};
  baseConfig.resolve.alias ??= {};
  const aliasConfig = baseConfig.resolve.alias;

  if (Array.isArray(aliasConfig)) {
    aliasConfig.push({
      name,
      alias,
    });
  } else {
    aliasConfig[name] = alias;
  }
}

// This is to help the addon in development
// Without it, webpack resolves packages in its node_modules instead of the example's node_modules
export const addScopedAlias = (baseConfig: WebpackConfig, name: string, alias?: string): void => {
  const scopedAlias = scopedResolve(`${alias ?? name}`);

  setAlias(baseConfig, name, scopedAlias);
};

/**
 * @example
 *
 * ```
 * // before main script path truncation
 * require.resolve('styled-jsx') === '/some/path/node_modules/styled-jsx/index.js
 * // after main script path truncation
 * scopedResolve('styled-jsx') === '/some/path/node_modules/styled-jsx'
 * ```
 *
 * @example
 *
 * ```
 * // referencing a named export of a package
 * scopedResolve('next/dist/compiled/react-dom/client') ===
 *   // returns the path to the package export without the script filename
 *   '/some/path/node_modules/next/dist/compiled/react-dom/client';
 *
 * // referencing a specific file within a CJS package
 * scopedResolve('next/dist/compiled/react-dom/cjs/react-dom-test-utils.production.js') ===
 *   // returns the path to the physical file, including the script filename
 *   '/some/path/node_modules/next/dist/compiled/react-dom/cjs/react-dom-test-utils.production.js';
 * ```
 *
 * @param id The module id or script file to resolve
 * @returns An absolute path to the specified module id or script file scoped to the project folder
 * @summary
 * This is to help the addon in development.
 * Without it, the addon resolves packages in its node_modules instead of the example's node_modules.
 * Because require.resolve will also include the main script as part of the path, this function strips
 * that to just include the path to the module folder when the id provided is a package or named export.
 */
export const scopedResolve = (id: string): string => {
  const scopedModulePath = require.resolve(id);
  const idWithNativePathSep = id.replace(/\//g /* all '/' occurrences */, sep);

  // If the id referenced the file specifically, return the full module path & filename
  if (scopedModulePath.endsWith(idWithNativePathSep)) {
    return scopedModulePath;
  }

  // Otherwise, return just the path to the module folder or named export
  const moduleFolderStrPosition = scopedModulePath.lastIndexOf(idWithNativePathSep);
  const beginningOfMainScriptPath = moduleFolderStrPosition + id.length;
  return scopedModulePath.substring(0, beginningOfMainScriptPath);
};

/**
 * Returns a RegExp that matches node_modules except for the given transpilePackages.
 *
 * @param transpilePackages Array of package names to NOT exclude (i.e., to include for
 *   transpilation)
 * @returns RegExp for use in Webpack's exclude
 */
export function getNodeModulesExcludeRegex(transpilePackages: string[]): RegExp {
  if (!transpilePackages || transpilePackages.length === 0) {
    return /node_modules/;
  }
  const escaped = transpilePackages
    .map((pkg) => pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`node_modules/(?!(${escaped})/)`);
}
