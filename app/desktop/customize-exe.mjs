import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , exeArg, iconArg, version = '1.0.0', productName = 'FlowMind 飞书 AI 工作台'] = process.argv;
if (!exeArg || !iconArg) {
  console.error('Usage: node customize-exe.mjs <exe> <icon.ico> [version] [productName]');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = path.resolve(exeArg);
const icon = path.resolve(iconArg);
await Promise.all([access(exe), access(icon)]);

const resEditUrl = pathToFileURL(path.join(here, '..', 'node_modules', 'app-builder-lib', 'out', 'util', 'resEdit.js'));
const { editWindowsResources } = await import(resEditUrl.href);
await editWindowsResources({
  file: exe,
  iconPath: icon,
  requestedExecutionLevel: 'asInvoker',
  fileVersion: version,
  productVersion: version,
  versionStrings: {
    CompanyName: 'FlowMind',
    FileDescription: productName,
    InternalName: 'FlowMind',
    LegalCopyright: 'Copyright © 2026',
    OriginalFilename: 'FlowMind.exe',
    ProductName: productName,
  },
});
console.log(`Customized Windows resources: ${exe}`);
