const fs = require('fs');
const os = require('os');
const path = require('path');

const target = process.env.WHEELMAKER_WEB_TARGET || path.join(os.homedir(), '.wheelmaker', 'web');
const limit = Number.parseInt(process.env.WHEELMAKER_WEB_ASSET_LIMIT || '20', 10);

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function collectFiles(dir, prefix = '') {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({
        name: relativePath.split(path.sep).join('/'),
        size: fs.statSync(absolutePath).size,
      });
    }
  }

  return files;
}

function summarizeByExtension(files) {
  const totals = new Map();

  for (const file of files) {
    const extension = path.extname(file.name) || '(none)';
    totals.set(extension, (totals.get(extension) || 0) + file.size);
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([extension, size]) => ({ extension, size }));
}

if (!fs.existsSync(target)) {
  console.error(`Web build target does not exist: ${target}`);
  process.exit(1);
}

const files = collectFiles(target).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
const totalSize = files.reduce((sum, file) => sum + file.size, 0);
const largestFiles = files.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20);

console.log('Web asset report');
console.log(`Target: ${target}`);
console.log(`Files: ${files.length}`);
console.log(`Total size: ${formatKiB(totalSize)}`);

console.log('');
console.log('Largest assets:');
for (const file of largestFiles) {
  console.log(`${file.name.padEnd(48)} ${formatKiB(file.size).padStart(10)}`);
}

console.log('');
console.log('By extension:');
for (const item of summarizeByExtension(files)) {
  console.log(`${item.extension.padEnd(12)} ${formatKiB(item.size).padStart(10)}`);
}
