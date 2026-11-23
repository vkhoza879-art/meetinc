import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const packageRoot = path.join(projectRoot, 'ios', 'App', 'CapApp-SPM');
const generatedRoot = path.join(packageRoot, 'symlinks');
const pluginSource = path.resolve(projectRoot, 'node_modules', '@capacitor-firebase', 'messaging');
const pluginTarget = path.join(generatedRoot, 'CapacitorFirebaseMessaging');
const packageFile = path.join(packageRoot, 'Package.swift');

let current = await fs.readFile(packageFile, 'utf8');
if (current.includes('product(name: "CapacitorFirebaseMessaging"')) process.exit(0);

if (process.platform === 'win32') {
  const targetParent = path.resolve(generatedRoot);
  const target = path.resolve(pluginTarget);
  if (!target.startsWith(`${targetParent}${path.sep}`)) throw new Error('Refusing to copy a native plugin outside its generated package folder.');
  await fs.mkdir(generatedRoot, { recursive: true });
  try {
    const stat = await fs.lstat(pluginTarget);
    if (!stat.isSymbolicLink()) await fs.rm(pluginTarget, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.lstat(pluginTarget);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.cp(pluginSource, pluginTarget, { recursive: true, dereference: true });
  }

  const capacitorVersion = JSON.parse(await fs.readFile(path.join(projectRoot, 'node_modules', '@capacitor', 'core', 'package.json'), 'utf8')).version;
  current = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "CapApp-SPM", targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${capacitorVersion}"),
        .package(name: "CapacitorFirebaseMessaging", path: "symlinks/CapacitorFirebaseMessaging")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorFirebaseMessaging", package: "CapacitorFirebaseMessaging")
            ]
        )
    ]
)
`;
  await fs.writeFile(packageFile, current, 'utf8');
}
